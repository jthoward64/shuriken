import { Effect, Option } from "effect";
import type { DatabaseClient } from "#src/db/client.ts";
import {
	type DatabaseError,
	type DavError,
	forbidden,
	methodNotAllowed,
	notFound,
	preconditionFailed,
	unauthorized,
} from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import { EntityId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { fireAndForgetBirthdayRegenerate } from "#src/services/birthday/event-hook.ts";
import type { BirthdayService } from "#src/services/birthday/service.ts";
import {
	type CollectionRepository,
	CollectionService,
} from "#src/services/collection/index.ts";
import {
	isAutoManagedCollection,
	isReadOnlyCollection,
} from "#src/services/collection/read-only-guard.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import {
	type InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { SchedulingService } from "#src/services/scheduling/index.ts";
import { deleteCollection, deleteInstance } from "./copy-move.ts";

// ---------------------------------------------------------------------------
// DELETE handler — RFC 4918 §9.6
// ---------------------------------------------------------------------------

/** Handles DELETE for CalDAV/CardDAV instances and collections. */
export const deleteHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	| InstanceService
	| InstanceRepository
	| CollectionService
	| CollectionRepository
	| EntityRepository
	| ComponentRepository
	| AclService
	| BirthdayService
	| ExternalCalendarRepository
	| SchedulingService
	| DatabaseClient
> =>
	Effect.gen(function* () {
		// Auth gate first — anonymous probes must not learn resource shapes
		// from 404/405 responses.
		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const principal = ctx.auth.principal;

		// new-instance/new-collection → resource does not exist (404).
		// Principal/root/well-known kinds do not support DELETE → 405.
		if (path.kind === "new-instance" || path.kind === "new-collection") {
			return yield* notFound("Resource not found");
		}
		if (path.kind !== "instance" && path.kind !== "collection") {
			return yield* methodNotAllowed();
		}

		// External-subscription members are read-only. DELETE on the
		// subscribed collection itself IS allowed (it's how a user
		// unsubscribes) — only block instance-level deletes.
		if (
			path.kind === "instance" &&
			(yield* isReadOnlyCollection(path.collectionId))
		) {
			return yield* forbidden("DAV:need-privileges");
		}
		// Auto-managed collections (e.g. birthdays) reject collection-level
		// DELETE too — there's no "unsubscribe" semantics, the server owns it.
		if (
			path.kind === "collection" &&
			(yield* isAutoManagedCollection(path.collectionId))
		) {
			return yield* forbidden("DAV:need-privileges");
		}

		return path.kind === "instance"
			? yield* deleteInstanceResource(path, ctx, principal.principalId)
			: yield* deleteCollectionResource(path, principal.principalId);
	});

// ---------------------------------------------------------------------------
// Instance DELETE
// ---------------------------------------------------------------------------

/**
 * RFC 6638: process scheduling before deletion, which sends a CANCEL to the
 * attendees of an organised event or a REPLY DECLINED to its organiser.
 */
const scheduleBeforeDelete = Effect.fn("dav.delete.schedule")(function* (
	instance: InstanceRow,
	actingPrincipalId: PrincipalId,
	suppressReply: boolean,
) {
	const componentRepo = yield* ComponentRepository;
	const treeOpt = yield* componentRepo.loadTree(
		EntityId(instance.entityId),
		"icalendar",
	);
	if (Option.isNone(treeOpt)) {
		return;
	}
	const schedulingSvc = yield* SchedulingService;
	yield* Effect.ignore(
		schedulingSvc.processAfterDelete({
			actingPrincipalId,
			doc: { kind: "icalendar", root: treeOpt.value },
			suppressReply,
		}),
	);
});

const deleteInstanceResource = Effect.fn("dav.delete.instance")(function* (
	path: Extract<ResolvedDavPath, { kind: "instance" }>,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
) {
	// ACL: unbind from the parent collection.
	const acl = yield* AclService;
	yield* acl.check(principalId, path.collectionId, "collection", "DAV:unbind");

	// Fetch instance to get entityId (findById returns 404 if not found).
	const instanceSvc = yield* InstanceService;
	const instance = yield* instanceSvc.findById(path.instanceId);

	// RFC 7232 §3.1: If-Match must match the current ETag.
	const ifMatch = ctx.headers.get("If-Match");
	if (ifMatch !== null && ifMatch !== "*" && ifMatch !== instance.etag) {
		return yield* preconditionFailed();
	}

	if (instance.contentType === "text/calendar") {
		yield* scheduleBeforeDelete(
			instance,
			principalId,
			ctx.headers.get("Schedule-Reply") === "no",
		);
	}

	yield* deleteInstance(instance);

	if (instance.contentType === "text/vcard") {
		yield* fireAndForgetBirthdayRegenerate(path.collectionId);
	}

	return new Response(null, { status: HTTP_NO_CONTENT });
});

// ---------------------------------------------------------------------------
// Collection DELETE
// ---------------------------------------------------------------------------

/**
 * Drops the subscription claim when a subscribed collection is deleted. If that
 * was the last claim on the shared external_calendar row, soft-delete it so the
 * scheduler stops polling; otherwise recompute its sync interval. Done before
 * deleting the collection because claim.collection_id is ON DELETE CASCADE.
 */
const releaseExternalClaim = Effect.fn("dav.delete.externalClaim")(function* (
	collectionId: CollectionId,
) {
	const extRepo = yield* ExternalCalendarRepository;
	const claimOpt = yield* extRepo.findClaimByCollection(collectionId);
	if (Option.isNone(claimOpt)) {
		return;
	}
	const claim = claimOpt.value;
	yield* extRepo.deleteClaim(claim.id);
	const remaining = yield* extRepo.countClaimsForExternal(
		claim.externalCalendarId,
	);
	yield* remaining === 0
		? extRepo.softDelete(claim.externalCalendarId)
		: extRepo.recomputeSyncInterval(claim.externalCalendarId);
});

const deleteCollectionResource = Effect.fn("dav.delete.collection")(function* (
	path: Extract<ResolvedDavPath, { kind: "collection" }>,
	principalId: PrincipalId,
) {
	// ACL: unbind from the owner principal's namespace.
	const acl = yield* AclService;
	yield* acl.check(principalId, path.principalId, "principal", "DAV:unbind");

	// Verify the collection exists (returns 404 via service if not found).
	const collectionSvc = yield* CollectionService;
	const collRow = yield* collectionSvc.findById(path.collectionId);

	// RFC 6638: inbox and outbox are server-managed; clients must not delete them.
	if (
		collRow.collectionType === "inbox" ||
		collRow.collectionType === "outbox"
	) {
		return yield* forbidden();
	}

	yield* releaseExternalClaim(path.collectionId);

	// Delete all active instances then the collection (RFC 4918 §9.6.1).
	yield* deleteCollection(path.collectionId);

	return new Response(null, { status: HTTP_NO_CONTENT });
});
