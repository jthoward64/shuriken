import { Effect, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	conflict,
	davError,
	forbidden,
	methodNotAllowed,
	notFound,
	preconditionFailed,
	unauthorized,
} from "#src/domain/errors.ts";
import {
	type CollectionId,
	EntityId,
	type InstanceId,
	type PrincipalId,
} from "#src/domain/ids.ts";
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
import { isReadOnlyCollection } from "#src/services/collection/read-only-guard.ts";
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
	parseDestination,
	parseOverwrite,
} from "./copy-move.ts";

// ---------------------------------------------------------------------------
// MOVE handler — RFC 4918 §9.9
// ---------------------------------------------------------------------------

/** Handles MOVE for CalDAV/CardDAV instances and collections. */
export const moveHandler = Effect.fn("dav.move")(function* (
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
		? yield* moveInstance(path, request)
		: yield* moveCollection(path, request);
});

/** Where a moved resource lands, and whether it replaced something */
interface MoveDestination {
	readonly destExisted: boolean;
	readonly destSlug: Slug;
}

// ---------------------------------------------------------------------------
// Instance MOVE
// ---------------------------------------------------------------------------

/**
 * Applies the destination-side ACL check for an instance MOVE and clears the
 * destination when overwriting. An existing destination keeps its slug so the
 * source moves into the same slot.
 */
const prepareMoveDestination = Effect.fn("dav.move.instanceDestination")(
	function* (
		principalId: PrincipalId,
		destPath: Extract<ResolvedDavPath, { kind: "instance" | "new-instance" }>,
		overwrite: boolean,
	) {
		if (destPath.kind === "new-instance") {
			return {
				destExisted: false,
				destSlug: destPath.slug,
			} satisfies MoveDestination;
		}
		if (!overwrite) {
			return yield* preconditionFailed();
		}
		// Overwriting an existing destination is effectively a delete —
		// require DAV:unbind on the destination collection too, mirroring
		// delete.ts (the caller's DAV:unbind check only covers the source).
		const acl = yield* AclService;
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
		} satisfies MoveDestination;
	},
);

/**
 * UID uniqueness - RFC 4791 §5.3.2 / RFC 6352 §5.1. Moving into a destination
 * collection that already contains another resource with the same UID must be
 * rejected. Only meaningful when crossing collections, since within one
 * collection the match would be the source itself.
 */
const assertNoUidConflict = Effect.fn("dav.move.uidConflict")(function* (
	sourceInstance: InstanceRow,
	destCollectionId: CollectionId,
) {
	const entityRepo = yield* EntityRepository;
	const sourceEntity = yield* entityRepo.findById(
		EntityId(sourceInstance.entityId),
	);
	const sourceUid = Option.match(sourceEntity, {
		onNone: () => null,
		onSome: (e) => e.logicalUid,
	});
	if (sourceUid === null) {
		return;
	}
	if (yield* entityRepo.existsByUid(destCollectionId, sourceUid)) {
		return yield* conflict(
			sourceInstance.contentType === "text/calendar"
				? "CALDAV:no-uid-conflict"
				: "CARDDAV:no-uid-conflict",
		);
	}
});

/**
 * Rebinds the source entity to a new instance row at the destination and
 * soft-deletes the source. The soft-delete fires the DB trigger that bumps the
 * source collection's sync-token and writes the tombstone sync-collection
 * clients need (RFC 6578 §6.1).
 */
const relinkInstance = Effect.fn("dav.move.relinkInstance")(function* (
	sourceInstance: InstanceRow,
	sourceInstanceId: InstanceId,
	destCollectionId: CollectionId,
	destSlug: Slug,
) {
	const instanceRepo = yield* InstanceRepository;
	yield* instanceRepo.insert({
		collectionId: destCollectionId,
		entityId: EntityId(sourceInstance.entityId),
		contentType: sourceInstance.contentType,
		etag: ETag(sourceInstance.etag),
		slug: destSlug,
		...(sourceInstance.scheduleTag
			? { scheduleTag: sourceInstance.scheduleTag }
			: {}),
	});
	yield* instanceRepo.softDelete(sourceInstanceId);
});

const moveInstance = Effect.fn("dav.move.instance")(function* (
	path: Extract<ResolvedDavPath, { kind: "instance" }>,
	{ principalId, destUrl, overwrite }: CopyMoveRequest,
) {
	const destPath = yield* parseDavPath(destUrl);

	// RFC 4918 §9.9: source and destination must differ.
	if (destPath.kind === "instance" && destPath.instanceId === path.instanceId) {
		return yield* forbidden();
	}

	// Destination must be an instance path (existing or new).
	if (destPath.kind !== "instance" && destPath.kind !== "new-instance") {
		return yield* conflict();
	}

	// Read-only: subscribed collections own their event set. Block both
	// MOVE-from (we'd be deleting a synced event) and MOVE-into (we'd be
	// adding a foreign event that the next sync would remove).
	if (yield* isReadOnlyCollection(path.collectionId)) {
		return yield* forbidden("DAV:need-privileges");
	}
	if (yield* isReadOnlyCollection(destPath.collectionId)) {
		return yield* forbidden("DAV:need-privileges");
	}

	const acl = yield* AclService;

	// ACL: unbind from source collection, bind to destination collection.
	yield* acl.check(principalId, path.collectionId, "collection", "DAV:unbind");
	yield* acl.check(
		principalId,
		destPath.collectionId,
		"collection",
		"DAV:bind",
	);

	// Fetch source instance before mutating anything.
	const instanceSvc = yield* InstanceService;
	const sourceInstance = yield* instanceSvc.findById(path.instanceId);

	const { destExisted, destSlug } = yield* prepareMoveDestination(
		principalId,
		destPath,
		overwrite,
	);

	if (destPath.collectionId !== path.collectionId) {
		yield* assertNoUidConflict(sourceInstance, destPath.collectionId);
	}

	// Insert a new instance row at the destination (same entity, preserving ETag
	// and content). RFC §9.9.1: DAV:creationdate SHOULD remain the same — we
	// preserve entity identity by reusing the existing entityId.
	// Both writes are atomic: RFC 4918 §9.9 requires source to be preserved if
	// the destination insert fails.
	const db = yield* DatabaseClient;
	yield* withTransaction(
		relinkInstance(
			sourceInstance,
			path.instanceId,
			destPath.collectionId,
			destSlug,
		),
	).pipe(Effect.provideService(DatabaseClient, db));

	return new Response(null, {
		status: destExisted ? HTTP_NO_CONTENT : HTTP_CREATED,
	});
});

// ---------------------------------------------------------------------------
// Collection MOVE
// ---------------------------------------------------------------------------

const moveCollection = Effect.fn("dav.move.collection")(function* (
	path: Extract<ResolvedDavPath, { kind: "collection" }>,
	{ principalId, destUrl, overwrite, req }: CopyMoveRequest,
) {
	// RFC 4918 §9.9: collection MOVE MUST act as Depth:infinity.
	// Reject any explicit Depth value other than "infinity".
	const depthHeader = req.headers.get("Depth");
	if (depthHeader !== null && depthHeader.trim().toLowerCase() !== "infinity") {
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
	yield* acl.check(principalId, destPath.principalId, "principal", "DAV:bind");

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
		// Overwriting an existing destination is effectively a delete —
		// require DAV:unbind on the destination principal too, mirroring
		// delete.ts (the DAV:unbind check above only covers the source).
		yield* acl.check(
			principalId,
			destPath.principalId,
			"principal",
			"DAV:unbind",
		);
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
