import { Effect } from "effect";
import {
	conflict,
	davError,
	forbidden,
	methodNotAllowed,
	notFound,
	preconditionFailed,
	unauthorized,
} from "#src/domain/errors.ts";
import { EntityId, type PrincipalId } from "#src/domain/ids.ts";
import { type ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_BAD_GATEWAY,
	HTTP_BAD_REQUEST,
	HTTP_CREATED,
	HTTP_NO_CONTENT,
} from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import {
	CollectionRepository,
	CollectionService,
} from "#src/services/collection/index.ts";
import {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import { parseDavPath } from "../router.ts";
import {
	deleteCollection,
	deleteInstance,
	parseDestination,
	parseOverwrite,
} from "./copy-move.ts";

// ---------------------------------------------------------------------------
// MOVE handler — RFC 4918 §9.9
// ---------------------------------------------------------------------------

/** Handles MOVE for CalDAV/CardDAV instances and collections. */
export const moveHandler = (
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
			return yield* moveInstance(
				path,
				principal.principalId,
				destUrl,
				overwrite,
			);
		}
		return yield* moveCollection(
			path,
			principal.principalId,
			destUrl,
			overwrite,
			req,
		);
	});

// ---------------------------------------------------------------------------
// Instance MOVE
// ---------------------------------------------------------------------------

const moveInstance = (
	path: Extract<ResolvedDavPath, { kind: "instance" }>,
	principalId: PrincipalId,
	destUrl: URL,
	overwrite: boolean,
) =>
	Effect.gen(function* () {
		const destPath = yield* parseDavPath(destUrl);

		// RFC 4918 §9.9: source and destination must differ.
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

		// ACL: unbind from source collection, bind to destination collection.
		yield* acl.check(
			principalId,
			path.collectionId,
			"collection",
			"DAV:unbind",
		);
		yield* acl.check(
			principalId,
			destPath.collectionId,
			"collection",
			"DAV:bind",
		);

		// Fetch source instance before mutating anything.
		const instanceSvc = yield* InstanceService;
		const sourceInstance = yield* instanceSvc.findById(path.instanceId);

		let destExisted = false;
		let destSlug: Slug;

		if (destPath.kind === "instance") {
			if (!overwrite) {
				return yield* preconditionFailed();
			}
			destExisted = true;
			const destInstance = yield* instanceSvc.findById(destPath.instanceId);
			// Capture slug before deleting so we can move source into the same slot.
			destSlug = Slug(destInstance.slug);
			yield* deleteInstance(destInstance);
		} else {
			// destPath.kind === "new-instance"
			destSlug = destPath.slug;
		}

		// Insert a new instance row at the destination (same entity, preserving ETag
		// and content). RFC §9.9.1: DAV:creationdate SHOULD remain the same — we
		// preserve entity identity by reusing the existing entityId.
		const instanceRepo = yield* InstanceRepository;
		yield* instanceRepo.insert({
			collectionId: destPath.collectionId,
			entityId: EntityId(sourceInstance.entityId),
			contentType: sourceInstance.contentType,
			etag: ETag(sourceInstance.etag),
			slug: destSlug,
			...(sourceInstance.scheduleTag
				? { scheduleTag: sourceInstance.scheduleTag }
				: {}),
		});

		// Soft-delete the source instance. The DB trigger fires on the deletedAt
		// change, increments the source collection's sync-token, and creates the
		// tombstone entry that sync-collection clients need to learn the resource
		// was removed (RFC 6578 §6.1).
		yield* instanceRepo.softDelete(path.instanceId);

		return new Response(null, {
			status: destExisted ? HTTP_NO_CONTENT : HTTP_CREATED,
		});
	});

// ---------------------------------------------------------------------------
// Collection MOVE
// ---------------------------------------------------------------------------

const moveCollection = (
	path: Extract<ResolvedDavPath, { kind: "collection" }>,
	principalId: PrincipalId,
	destUrl: URL,
	overwrite: boolean,
	req: Request,
) =>
	Effect.gen(function* () {
		// RFC 4918 §9.9: collection MOVE MUST act as Depth:infinity.
		// Reject any explicit Depth value other than "infinity".
		const depthHeader = req.headers.get("Depth");
		if (
			depthHeader !== null &&
			depthHeader.trim().toLowerCase() !== "infinity"
		) {
			return yield* Effect.fail(
				davError(
					HTTP_BAD_REQUEST,
					undefined,
					"Depth header on collection MOVE must be infinity",
				),
			);
		}

		const destPath = yield* parseDavPath(destUrl);

		// RFC 4918 §9.9: source and destination must differ.
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

		// ACL: unbind from source principal, bind to destination principal.
		yield* acl.check(principalId, path.principalId, "principal", "DAV:unbind");
		yield* acl.check(
			principalId,
			destPath.principalId,
			"principal",
			"DAV:bind",
		);

		// Verify source exists (returns 404 via service if not found).
		const collectionSvc = yield* CollectionService;
		yield* collectionSvc.findById(path.collectionId);

		let destExisted = false;
		let destSlug: Slug;

		if (destPath.kind === "collection") {
			if (!overwrite) {
				return yield* preconditionFailed();
			}
			destExisted = true;
			// Capture slug before deleting.
			destSlug = Slug(destPath.collectionSeg);
			yield* deleteCollection(destPath.collectionId);
		} else {
			// destPath.kind === "new-collection"
			destSlug = destPath.slug;
		}

		// Move collection in-place: update ownerPrincipalId + slug.
		// All instances follow automatically via their collectionId FK.
		const collectionRepo = yield* CollectionRepository;
		yield* collectionRepo.relocate(
			path.collectionId,
			destPath.principalId,
			destSlug,
		);

		return new Response(null, {
			status: destExisted ? HTTP_NO_CONTENT : HTTP_CREATED,
		});
	});
