import { Effect } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_SEE_OTHER } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";

export const feedsRegenerateHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	id: UuidString,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ShareLinkService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const svc = yield* ShareLinkService;
		yield* svc.regenerateToken(id, {
			userId: principal.userId,
			principalId: principal.principalId,
		});
		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: `/ui/feeds/${id}` },
		});
	});
