import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, notFound } from "#src/domain/errors.ts";
import type { InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { TrashService } from "#src/services/trash/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/trash/instances/:instanceId/purge
// ---------------------------------------------------------------------------

export const trashPurgeInstanceHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<Response, DavError | DatabaseError, TrashService> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const trashSvc = yield* TrashService;

		yield* trashSvc
			.purgeInstanceForever(instanceId, principal.principalId)
			.pipe(
				Effect.catchTags({
					TrashNotFound: () => Effect.fail(notFound("Item not found in trash")),
					TrashNotOwner: () =>
						Effect.fail(forbidden(undefined, "Not the owner of this item")),
				}),
			);

		const destination = "/ui/trash";
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": destination },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: destination },
		});
	});
