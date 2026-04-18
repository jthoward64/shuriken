import { Effect, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrDeadProperties } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	conflict,
	forbidden,
	methodNotAllowed,
	notFound,
	preconditionFailed,
	someOrNotFound,
	unauthorized,
} from "#src/domain/errors.ts";
import {
	CollectionId,
	EntityId,
	InstanceId,
	type PrincipalId,
} from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { type ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_BAD_GATEWAY,
	HTTP_CREATED,
	HTTP_NO_CONTENT,
} from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import { parseDavPath } from "../router.ts";
import {
	deleteCollection,
	deleteInstance,
	parseDepth,
	parseDestination,
	parseOverwrite,
} from "./copy-move.ts";

// ---------------------------------------------------------------------------
// COPY handler — RFC 4918 §9.8
// ---------------------------------------------------------------------------

/** Handles COPY for CalDAV/CardDAV instances and collections. */
export const copyHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
) =>
	Effect.gen(function* () {
		if (path.kind === "new-instance" || path.kind === "new-collection") {
			return yield* notFound("Source resource not found");
		}
		if (path.kind !== "instance" && path.kind !== "collection") {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const principal = ctx.auth.principal;

		const destUrl = yield* parseDestination(req);
		if (destUrl.origin !== ctx.url.origin) {
			return new Response(null, { status: HTTP_BAD_GATEWAY });
		}
		const overwrite = parseOverwrite(req);

		if (path.kind === "instance") {
			return yield* copyInstance(
				path,
				principal.principalId,
				destUrl,
				overwrite,
				req,
			);
		}
		return yield* copyCollection(
			path,
			principal.principalId,
			destUrl,
			overwrite,
			req,
		);
	});

// ---------------------------------------------------------------------------
// Instance COPY
// ---------------------------------------------------------------------------

const copyInstance = (
	path: Extract<ResolvedDavPath, { kind: "instance" }>,
	principalId: PrincipalId,
	destUrl: URL,
	overwrite: boolean,
	_req: Request,
) =>
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const destPath = yield* parseDavPath(destUrl);

		// RFC 4918 §9.8.5: source and destination must differ.
		if (
			destPath.kind === "instance" &&
			destPath.instanceId === path.instanceId
		) {
			return yield* forbidden();
		}

		// Destination must be an instance path (existing or new).
		if (destPath.kind !== "instance" && destPath.kind !== "new-instance") {
			return yield* conflict();
		}

		const acl = yield* AclService;

		// ACL: read on source instance.
		yield* acl.check(principalId, path.instanceId, "instance", "DAV:read");

		// Load source.
		const instanceSvc = yield* InstanceService;
		const sourceInstance = yield* instanceSvc.findById(path.instanceId);

		const entityRepo = yield* EntityRepository;
		const sourceEntity = yield* entityRepo
			.findById(EntityId(sourceInstance.entityId))
			.pipe(Effect.flatMap(someOrNotFound("Source entity not found")));

		const entityType =
			sourceInstance.contentType === "text/calendar" ? "icalendar" : "vcard";

		const componentRepo = yield* ComponentRepository;
		const irRoot = yield* componentRepo
			.loadTree(EntityId(sourceInstance.entityId), entityType)
			.pipe(Effect.flatMap(someOrNotFound("Source component tree not found")));

		let destExisted = false;
		let destSlug: Slug;

		if (destPath.kind === "instance") {
			if (!overwrite) {
				return yield* preconditionFailed();
			}
			destExisted = true;
			yield* acl.check(
				principalId,
				destPath.collectionId,
				"collection",
				"DAV:bind",
			);
			const destInstance = yield* instanceSvc.findById(destPath.instanceId);
			// Preserve the existing destination slug (its URL identity).
			destSlug = Slug(destInstance.slug);
			yield* deleteInstance(destInstance);
		} else {
			// destPath.kind === "new-instance"
			yield* acl.check(
				principalId,
				destPath.collectionId,
				"collection",
				"DAV:bind",
			);
			destSlug = destPath.slug;
		}

		// Compute fresh ETag from canonical encoding.
		const canonical =
			entityType === "icalendar"
				? yield* encodeICalendar({ kind: "icalendar", root: irRoot })
				: yield* encodeVCard({ kind: "vcard", root: irRoot });
		const etag = ETag(yield* makeEtag(canonical));

		// Create entity, clone component tree, insert instance, copy ACEs atomically.
		const instanceRepo = yield* InstanceRepository;
		const sourceAces = yield* acl.getAces(path.instanceId, "instance");
		const nonProtectedAces = sourceAces.filter((a) => !a.protected);
		yield* withTransaction(
			Effect.gen(function* () {
				const newEntity = yield* entityRepo.insert({
					entityType,
					logicalUid: sourceEntity.logicalUid,
				});
				yield* componentRepo.insertTree(EntityId(newEntity.id), irRoot);
				const inst = yield* instanceRepo.insert({
					collectionId: destPath.collectionId,
					entityId: EntityId(newEntity.id),
					contentType: sourceInstance.contentType,
					etag,
					slug: destSlug,
					clientProperties: sourceInstance.clientProperties as IrDeadProperties,
					contentLength: new TextEncoder().encode(canonical).byteLength,
				});
				if (nonProtectedAces.length > 0) {
					yield* acl.setAces(
						InstanceId(inst.id),
						"instance",
						nonProtectedAces.map((a, i) => ({
							resourceType: "instance" as const,
							resourceId: inst.id,
							principalType: a.principalType,
							principalId: a.principalId ?? undefined,
							privilege: a.privilege as DavPrivilege,
							grantDeny: a.grantDeny,
							protected: false,
							ordinal: i,
						})),
					);
				}
				return inst;
			}),
		).pipe(Effect.provideService(DatabaseClient, db));

		return new Response(null, {
			status: destExisted ? HTTP_NO_CONTENT : HTTP_CREATED,
			headers: { ETag: etag },
		});
	});

// ---------------------------------------------------------------------------
// Collection COPY
// ---------------------------------------------------------------------------

const copyCollection = (
	path: Extract<ResolvedDavPath, { kind: "collection" }>,
	principalId: PrincipalId,
	destUrl: URL,
	overwrite: boolean,
	req: Request,
) =>
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const depth = yield* parseDepth(req, "infinity");
		const destPath = yield* parseDavPath(destUrl);

		// RFC 4918 §9.8.5: source and destination must differ.
		if (
			destPath.kind === "collection" &&
			destPath.collectionId === path.collectionId
		) {
			return yield* forbidden();
		}

		// Destination must be a collection path (existing or new).
		if (destPath.kind !== "collection" && destPath.kind !== "new-collection") {
			return yield* conflict();
		}

		const acl = yield* AclService;

		// ACL: read on source collection.
		yield* acl.check(principalId, path.collectionId, "collection", "DAV:read");

		const collectionSvc = yield* CollectionService;
		const sourceCollection = yield* collectionSvc.findById(path.collectionId);

		let destExisted = false;
		let destSlug: Slug;
		let destPrincipalId: PrincipalId;

		if (destPath.kind === "collection") {
			if (!overwrite) {
				return yield* preconditionFailed();
			}
			destExisted = true;
			destSlug = Slug(destPath.collectionSeg);
			destPrincipalId = destPath.principalId;
			yield* acl.check(principalId, destPrincipalId, "principal", "DAV:bind");
			yield* deleteCollection(destPath.collectionId);
		} else {
			// destPath.kind === "new-collection"
			destSlug = destPath.slug;
			destPrincipalId = destPath.principalId;
			yield* acl.check(principalId, destPrincipalId, "principal", "DAV:bind");
		}

		// Create destination collection with same metadata.
		const newCollection = yield* collectionSvc.create({
			ownerPrincipalId: destPrincipalId,
			collectionType: sourceCollection.collectionType,
			slug: destSlug,
			displayName: sourceCollection.displayName ?? undefined,
			description: sourceCollection.description ?? undefined,
			timezoneTzid: sourceCollection.timezoneTzid ?? undefined,
			supportedComponents:
				(sourceCollection.supportedComponents as Array<string>) ?? undefined,
		});

		// RFC 4918 §9.8.2: copy dead properties to the new collection.
		const srcCollectionProps =
			sourceCollection.clientProperties as IrDeadProperties;
		if (Object.keys(srcCollectionProps).length > 0) {
			yield* collectionSvc.updateProperties(CollectionId(newCollection.id), {
				clientProperties: srcCollectionProps,
			});
		}

		// RFC 4918 §9.8.2: copy non-protected ACEs from source collection.
		const collectionSourceAces = yield* acl.getAces(
			path.collectionId,
			"collection",
		);
		const collectionNonProtectedAces = collectionSourceAces.filter(
			(a) => !a.protected,
		);
		if (collectionNonProtectedAces.length > 0) {
			yield* acl.setAces(
				CollectionId(newCollection.id),
				"collection",
				collectionNonProtectedAces.map((a, i) => ({
					resourceType: "collection" as const,
					resourceId: newCollection.id,
					principalType: a.principalType,
					principalId: a.principalId ?? undefined,
					privilege: a.privilege as DavPrivilege,
					grantDeny: a.grantDeny,
					protected: false,
					ordinal: i,
				})),
			);
		}

		// Depth: infinity — copy all instances.
		if (depth === "infinity") {
			const instanceRepo = yield* InstanceRepository;
			const instances = yield* instanceRepo.listByCollection(path.collectionId);

			const entityRepo = yield* EntityRepository;
			const componentRepo = yield* ComponentRepository;

			yield* Effect.forEach(
				instances,
				(inst) =>
					Effect.gen(function* () {
						const srcEntityType =
							inst.contentType === "text/calendar" ? "icalendar" : "vcard";

						const irRootOpt = yield* componentRepo.loadTree(
							EntityId(inst.entityId),
							srcEntityType,
						);
						const irRoot = Option.getOrNull(irRootOpt);
						if (irRoot === null) {
							// Skip instances whose component tree is gone (should not happen in normal flow).
							return;
						}

						const srcEntity = yield* entityRepo
							.findById(EntityId(inst.entityId))
							.pipe(Effect.flatMap(someOrNotFound("Source entity not found")));

						const canonical =
							srcEntityType === "icalendar"
								? yield* encodeICalendar({ kind: "icalendar", root: irRoot })
								: yield* encodeVCard({ kind: "vcard", root: irRoot });
						const etag = ETag(yield* makeEtag(canonical));

						// Copy non-protected ACEs for each instance.
						const instAces = yield* acl.getAces(InstanceId(inst.id), "instance");
						const instNonProtected = instAces.filter((a) => !a.protected);

						yield* withTransaction(
							Effect.gen(function* () {
								const newEntity = yield* entityRepo.insert({
									entityType: srcEntityType,
									logicalUid: srcEntity.logicalUid,
								});
								yield* componentRepo.insertTree(EntityId(newEntity.id), irRoot);
								const newInst = yield* instanceRepo.insert({
									collectionId: CollectionId(newCollection.id),
									entityId: EntityId(newEntity.id),
									contentType: inst.contentType,
									etag,
									slug: Slug(inst.slug),
									clientProperties: inst.clientProperties as IrDeadProperties,
									contentLength: new TextEncoder().encode(canonical).byteLength,
								});
								if (instNonProtected.length > 0) {
									yield* acl.setAces(
										InstanceId(newInst.id),
										"instance",
										instNonProtected.map((a, i) => ({
											resourceType: "instance" as const,
											resourceId: newInst.id,
											principalType: a.principalType,
											principalId: a.principalId ?? undefined,
											privilege: a.privilege as DavPrivilege,
											grantDeny: a.grantDeny,
											protected: false,
											ordinal: i,
										})),
									);
								}
							}),
						).pipe(Effect.provideService(DatabaseClient, db));
					}),
				{ discard: true },
			);
		}

		return new Response(null, {
			status: destExisted ? HTTP_NO_CONTENT : HTTP_CREATED,
		});
	});
