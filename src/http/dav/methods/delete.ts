import { Effect } from "effect";
import {
	type DatabaseError,
	type DavError,
	forbidden,
	methodNotAllowed,
	notFound,
	preconditionFailed,
} from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import {
	type CollectionRepository,
	CollectionService,
} from "#src/services/collection/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import {
	type InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
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
			return yield* forbidden("DAV:need-privileges");
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
		yield* collectionSvc.findById(path.collectionId);

		// Delete all active instances then the collection (RFC 4918 §9.6.1).
		yield* deleteCollection(path.collectionId);

		return new Response(null, { status: HTTP_NO_CONTENT });
	});
