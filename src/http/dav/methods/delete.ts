import { Effect, Option } from "effect";
import {
	type DatabaseError,
	type DavError,
	forbidden,
	methodNotAllowed,
	notFound,
	preconditionFailed,
	unauthorized,
} from "#src/domain/errors.ts";
import { EntityId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import {
	type CollectionRepository,
	CollectionService,
} from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import {
	type InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
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
	| SchedulingService
> =>
	Effect.gen(function* () {
		// new-instance/new-collection → resource does not exist (404).
		// Principal/root/well-known kinds do not support DELETE → 405.
		if (path.kind === "new-instance" || path.kind === "new-collection") {
			return yield* notFound("Resource not found");
		}
		if (path.kind !== "instance" && path.kind !== "collection") {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const principal = ctx.auth.principal;

		const acl = yield* AclService;

		if (path.kind === "instance") {
			// ACL: unbind from the parent collection.
			yield* acl.check(
				principal.principalId,
				path.collectionId,
				"collection",
				"DAV:unbind",
			);

			// Fetch instance to get entityId (findById returns 404 if not found).
			const instanceSvc = yield* InstanceService;
			const instance = yield* instanceSvc.findById(path.instanceId);

			// RFC 7232 §3.1: If-Match must match the current ETag.
			const ifMatch = ctx.headers.get("If-Match");
			if (ifMatch !== null && ifMatch !== "*" && ifMatch !== instance.etag) {
				return yield* preconditionFailed();
			}

			// RFC 6638: process scheduling before deletion (sends CANCEL or REPLY DECLINED).
			if (instance.contentType === "text/calendar") {
				const componentRepo = yield* ComponentRepository;
				const treeOpt = yield* componentRepo.loadTree(
					EntityId(instance.entityId),
					"icalendar",
				);
				if (Option.isSome(treeOpt)) {
					const schedulingSvc = yield* SchedulingService;
					yield* Effect.ignore(
						schedulingSvc.processAfterDelete({
							actingPrincipalId: principal.principalId,
							doc: { kind: "icalendar", root: treeOpt.value },
							suppressReply:
								ctx.headers.get("Schedule-Reply") === "no",
						}),
					);
				}
			}

			yield* deleteInstance(instance);

			return new Response(null, { status: HTTP_NO_CONTENT });
		}

		// path.kind === "collection"
		// ACL: unbind from the owner principal's namespace.
		yield* acl.check(
			principal.principalId,
			path.principalId,
			"principal",
			"DAV:unbind",
		);

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

		// Delete all active instances then the collection (RFC 4918 §9.6.1).
		yield* deleteCollection(path.collectionId);

		return new Response(null, { status: HTTP_NO_CONTENT });
	});
