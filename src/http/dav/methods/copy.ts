import { Effect, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import { upgradeToV4 } from "#src/data/vcard/upgrade-v4.ts";
import { DatabaseClient } from "#src/db/client.ts";
import type { ContentType } from "#src/db/drizzle/schema/index.ts";
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
import type { AceRow, NewAce } from "#src/services/acl/repository.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { isReadOnlyCollection } from "#src/services/collection/read-only-guard.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { parseDavPath } from "../parse-path.ts";
import {
	type CopyMoveRequest,
	deleteCollection,
	deleteInstance,
	parseDepth,
	parseDestination,
	parseOverwrite,
} from "./copy-move.ts";
import { readDeadProperties } from "./dead-properties.ts";

// ---------------------------------------------------------------------------
// COPY handler — RFC 4918 §9.8
// ---------------------------------------------------------------------------

/** Handles COPY for CalDAV/CardDAV instances and collections. */
export const copyHandler = Effect.fn("dav.copy")(function* (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
) {
	// Auth gate first — defense in depth alongside the central davRouter gate.
	if (ctx.auth._tag !== "Authenticated") {
		return yield* unauthorized();
	}
	const principal = ctx.auth.principal;

	if (path.kind === "new-instance" || path.kind === "new-collection") {
		return yield* notFound("Source resource not found");
	}
	if (path.kind !== "instance" && path.kind !== "collection") {
		return yield* methodNotAllowed();
	}

	const destUrl = yield* parseDestination(req);
	if (destUrl.origin !== ctx.url.origin) {
		return new Response(null, { status: HTTP_BAD_GATEWAY });
	}
	const request: CopyMoveRequest = {
		principalId: principal.principalId,
		destUrl,
		overwrite: parseOverwrite(req),
		req,
	};

	return path.kind === "instance"
		? yield* copyInstance(path, request)
		: yield* copyCollection(path, request);
});

// ---------------------------------------------------------------------------
// Shared copy helpers
// ---------------------------------------------------------------------------

/** iCalendar and vCard are distinguished by the instance's stored content type */
const entityTypeOf = (contentType: ContentType): "icalendar" | "vcard" =>
	contentType === "text/calendar" ? "icalendar" : "vcard";

/**
 * Re-bases a resource's non-protected ACEs onto a copy of it.
 * RFC 4918 §9.8.2: protected ACEs belong to the new resource, not the source.
 */
const rebaseAces = (
	aces: ReadonlyArray<AceRow>,
	resourceType: "instance" | "collection",
	resourceId: NewAce["resourceId"],
): ReadonlyArray<NewAce> =>
	aces
		.filter((a) => !a.protected)
		.map((a, i) => ({
			resourceType,
			resourceId,
			principalType: a.principalType,
			principalId: a.principalId ?? undefined,
			privilege: a.privilege as DavPrivilege,
			grantDeny: a.grantDeny,
			protected: false,
			ordinal: i,
		}));

/** What a copied instance's body encodes to, plus the ETag that identifies it */
interface CopiedBody {
	readonly canonical: string;
	readonly etag: ETag;
}

/** Canonically re-encodes a loaded component tree so the copy gets a fresh ETag */
const encodeCopiedBody = Effect.fn("dav.copy.encodeBody")(function* (
	entityType: "icalendar" | "vcard",
	irRoot: IrComponent,
) {
	const canonical =
		entityType === "icalendar"
			? yield* encodeICalendar({ kind: "icalendar", root: irRoot })
			: yield* encodeVCard({ kind: "vcard", root: irRoot });
	const etag = ETag(yield* makeEtag(canonical));
	return { canonical, etag } satisfies CopiedBody;
});

// ---------------------------------------------------------------------------
// Instance COPY
// ---------------------------------------------------------------------------

/** Where a copied instance lands, and whether it replaced something */
interface InstanceDestination {
	readonly destExisted: boolean;
	readonly destSlug: Slug;
}

/**
 * Applies the ACL checks for an instance destination and clears it when
 * overwriting. An existing destination keeps its slug, which is its URL identity.
 */
const prepareInstanceDestination = Effect.fn("dav.copy.instanceDestination")(
	function* (
		principalId: PrincipalId,
		destPath: Extract<ResolvedDavPath, { kind: "instance" | "new-instance" }>,
		overwrite: boolean,
	) {
		const acl = yield* AclService;
		if (destPath.kind === "new-instance") {
			yield* acl.check(
				principalId,
				destPath.collectionId,
				"collection",
				"DAV:bind",
			);
			return {
				destExisted: false,
				destSlug: destPath.slug,
			} satisfies InstanceDestination;
		}

		if (!overwrite) {
			return yield* preconditionFailed();
		}
		yield* acl.check(
			principalId,
			destPath.collectionId,
			"collection",
			"DAV:bind",
		);
		// Overwriting an existing destination is effectively a delete —
		// require DAV:unbind too, mirroring delete.ts.
		yield* acl.check(
			principalId,
			destPath.collectionId,
			"collection",
			"DAV:unbind",
		);
		const instanceSvc = yield* InstanceService;
		const destInstance = yield* instanceSvc.findById(destPath.instanceId);
		yield* deleteInstance(destInstance);
		return {
			destExisted: true,
			destSlug: Slug(destInstance.slug),
		} satisfies InstanceDestination;
	},
);

/** Everything needed to materialise one copied instance in the destination */
interface InsertCopyInput {
	readonly collectionId: CollectionId;
	readonly entityType: "icalendar" | "vcard";
	readonly irRoot: IrComponent;
	readonly logicalUid: string | null;
	readonly contentType: ContentType;
	readonly slug: Slug;
	readonly clientProperties: unknown;
	readonly body: CopiedBody;
	readonly sourceAces: ReadonlyArray<AceRow>;
}

/** Creates the entity, component tree, instance row and ACEs for one copy */
const insertCopiedInstance = Effect.fn("dav.copy.insertInstance")(function* (
	input: InsertCopyInput,
) {
	const entityRepo = yield* EntityRepository;
	const componentRepo = yield* ComponentRepository;
	const instanceRepo = yield* InstanceRepository;
	const acl = yield* AclService;

	const newEntity = yield* entityRepo.insert({
		entityType: input.entityType,
		logicalUid: input.logicalUid,
	});
	yield* componentRepo.insertTree(EntityId(newEntity.id), input.irRoot);
	const inst = yield* instanceRepo.insert({
		collectionId: input.collectionId,
		entityId: EntityId(newEntity.id),
		contentType: input.contentType,
		etag: input.body.etag,
		slug: input.slug,
		clientProperties: readDeadProperties(input.clientProperties),
		contentLength: new TextEncoder().encode(input.body.canonical).byteLength,
	});
	const aces = rebaseAces(input.sourceAces, "instance", inst.id);
	if (aces.length > 0) {
		yield* acl.setAces(InstanceId(inst.id), "instance", aces);
	}
});

const copyInstance = Effect.fn("dav.copy.instance")(function* (
	path: Extract<ResolvedDavPath, { kind: "instance" }>,
	{ principalId, destUrl, overwrite }: CopyMoveRequest,
) {
	const db = yield* DatabaseClient;
	const destPath = yield* parseDavPath(destUrl);

	// RFC 4918 §9.8.5: source and destination must differ.
	if (destPath.kind === "instance" && destPath.instanceId === path.instanceId) {
		return yield* forbidden();
	}

	// Destination must be an instance path (existing or new).
	if (destPath.kind !== "instance" && destPath.kind !== "new-instance") {
		return yield* conflict();
	}

	// Subscribed collections are read-only — block COPY-into. COPY-from
	// is fine: it produces a new resource elsewhere, leaves the source feed alone.
	if (yield* isReadOnlyCollection(destPath.collectionId)) {
		return yield* forbidden("DAV:need-privileges");
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

	const entityType = entityTypeOf(sourceInstance.contentType);

	const componentRepo = yield* ComponentRepository;
	const loadedRoot = yield* componentRepo
		.loadTree(EntityId(sourceInstance.entityId), entityType)
		.pipe(Effect.flatMap(someOrNotFound("Source component tree not found")));
	// Normalize copied vCards to canonical 4.0 (matches PUT ingest).
	const irRoot =
		entityType === "vcard"
			? upgradeToV4({ kind: "vcard", root: loadedRoot }).root
			: loadedRoot;

	const { destExisted, destSlug } = yield* prepareInstanceDestination(
		principalId,
		destPath,
		overwrite,
	);

	// UID uniqueness — RFC 4791 §5.3.2 / RFC 6352 §5.1. The destination
	// collection must not already contain another resource with the source's
	// UID (the overwrite path above already deleted the destination if it
	// existed; what we're guarding against is *another* instance in the same
	// destination collection that happens to share this UID).
	const uidConflict =
		sourceEntity.logicalUid !== null &&
		(yield* entityRepo.existsByUid(
			destPath.collectionId,
			sourceEntity.logicalUid,
		));
	if (uidConflict) {
		return yield* conflict(
			entityType === "icalendar"
				? "CALDAV:no-uid-conflict"
				: "CARDDAV:no-uid-conflict",
		);
	}

	const body = yield* encodeCopiedBody(entityType, irRoot);

	// Create entity, clone component tree, insert instance, copy ACEs atomically.
	const sourceAces = yield* acl.getAces(path.instanceId, "instance");
	yield* withTransaction(
		insertCopiedInstance({
			collectionId: destPath.collectionId,
			entityType,
			irRoot,
			logicalUid: sourceEntity.logicalUid,
			contentType: sourceInstance.contentType,
			slug: destSlug,
			clientProperties: sourceInstance.clientProperties,
			body,
			sourceAces,
		}),
	).pipe(Effect.provideService(DatabaseClient, db));

	return new Response(null, {
		status: destExisted ? HTTP_NO_CONTENT : HTTP_CREATED,
		headers: { ETag: body.etag },
	});
});

// ---------------------------------------------------------------------------
// Collection COPY
// ---------------------------------------------------------------------------

/** Where a copied collection lands, and whether it replaced something */
interface CollectionDestination {
	readonly destExisted: boolean;
	readonly destSlug: Slug;
	readonly destPrincipalId: PrincipalId;
}

/**
 * Applies the ACL checks for a collection destination and clears it when
 * overwriting.
 */
const prepareCollectionDestination = Effect.fn(
	"dav.copy.collectionDestination",
)(function* (
	principalId: PrincipalId,
	destPath: Extract<ResolvedDavPath, { kind: "collection" | "new-collection" }>,
	overwrite: boolean,
) {
	const acl = yield* AclService;
	const destPrincipalId = destPath.principalId;

	if (destPath.kind === "new-collection") {
		yield* acl.check(principalId, destPrincipalId, "principal", "DAV:bind");
		return {
			destExisted: false,
			destSlug: destPath.slug,
			destPrincipalId,
		} satisfies CollectionDestination;
	}

	if (!overwrite) {
		return yield* preconditionFailed();
	}
	yield* acl.check(principalId, destPrincipalId, "principal", "DAV:bind");
	// Overwriting an existing destination is effectively a delete —
	// require DAV:unbind too, mirroring delete.ts.
	yield* acl.check(principalId, destPrincipalId, "principal", "DAV:unbind");
	yield* deleteCollection(destPath.collectionId);
	return {
		destExisted: true,
		destSlug: Slug(destPath.collectionSeg),
		destPrincipalId,
	} satisfies CollectionDestination;
});

/** Copies one member instance into the destination collection */
const copyMemberInstance = Effect.fn("dav.copy.member")(function* (
	inst: InstanceRow,
	destCollectionId: CollectionId,
) {
	const db = yield* DatabaseClient;
	const componentRepo = yield* ComponentRepository;
	const entityRepo = yield* EntityRepository;
	const acl = yield* AclService;

	const srcEntityType = entityTypeOf(inst.contentType);
	const loadedRoot = yield* componentRepo.loadTree(
		EntityId(inst.entityId),
		srcEntityType,
	);
	// Skip instances whose component tree is gone (should not happen in normal flow).
	if (Option.isNone(loadedRoot)) {
		return;
	}
	// Normalize copied vCards to canonical 4.0 (matches PUT ingest).
	const irRoot =
		srcEntityType === "vcard"
			? upgradeToV4({ kind: "vcard", root: loadedRoot.value }).root
			: loadedRoot.value;

	const srcEntity = yield* entityRepo
		.findById(EntityId(inst.entityId))
		.pipe(Effect.flatMap(someOrNotFound("Source entity not found")));

	const body = yield* encodeCopiedBody(srcEntityType, irRoot);
	const sourceAces = yield* acl.getAces(InstanceId(inst.id), "instance");

	yield* withTransaction(
		insertCopiedInstance({
			collectionId: destCollectionId,
			entityType: srcEntityType,
			irRoot,
			logicalUid: srcEntity.logicalUid,
			contentType: inst.contentType,
			slug: Slug(inst.slug),
			clientProperties: inst.clientProperties,
			body,
			sourceAces,
		}),
	).pipe(Effect.provideService(DatabaseClient, db));
});

const copyCollection = Effect.fn("dav.copy.collection")(function* (
	path: Extract<ResolvedDavPath, { kind: "collection" }>,
	{ principalId, destUrl, overwrite, req }: CopyMoveRequest,
) {
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

	const { destExisted, destSlug, destPrincipalId } =
		yield* prepareCollectionDestination(principalId, destPath, overwrite);

	// Create destination collection with same metadata.
	const newCollection = yield* collectionSvc.create({
		ownerPrincipalId: destPrincipalId,
		collectionType: sourceCollection.collectionType,
		slug: destSlug,
		displayName: sourceCollection.displayName ?? undefined,
		description: sourceCollection.description ?? undefined,
		timezoneTzid: sourceCollection.timezoneTzid ?? undefined,
		supportedComponents: sourceCollection.supportedComponents ?? undefined,
	});

	// RFC 4918 §9.8.2: copy dead properties to the new collection.
	const srcCollectionProps = readDeadProperties(
		sourceCollection.clientProperties,
	);
	if (Object.keys(srcCollectionProps).length > 0) {
		yield* collectionSvc.updateProperties(CollectionId(newCollection.id), {
			clientProperties: srcCollectionProps,
		});
	}

	// RFC 4918 §9.8.2: copy non-protected ACEs from source collection.
	const collectionAces = rebaseAces(
		yield* acl.getAces(path.collectionId, "collection"),
		"collection",
		newCollection.id,
	);
	if (collectionAces.length > 0) {
		yield* acl.setAces(
			CollectionId(newCollection.id),
			"collection",
			collectionAces,
		);
	}

	// Depth: infinity — copy all instances.
	if (depth === "infinity") {
		const instanceRepo = yield* InstanceRepository;
		const instances = yield* instanceRepo.listByCollection(path.collectionId);
		yield* Effect.forEach(
			instances,
			(inst) => copyMemberInstance(inst, CollectionId(newCollection.id)),
			{ discard: true },
		);
	}

	return new Response(null, {
		status: destExisted ? HTTP_NO_CONTENT : HTTP_CREATED,
	});
});
