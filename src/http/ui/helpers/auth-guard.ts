import { Effect } from "effect";
import { davError } from "#src/domain/errors.ts";
import type {
	AuthenticatedPrincipal,
	AuthResult,
} from "#src/domain/types/dav.ts";
import { HTTP_UNAUTHORIZED } from "#src/http/status.ts";

// ---------------------------------------------------------------------------
// Auth guard — extract authenticated principal or fail with 401
// ---------------------------------------------------------------------------

export const requireAuthenticated = (
	auth: AuthResult,
): Effect.Effect<
	AuthenticatedPrincipal,
	import("#src/domain/errors.ts").DavError
> => {
	if (auth._tag === "Authenticated") {
		return Effect.succeed(auth.principal);
	}
	return Effect.fail(davError(HTTP_UNAUTHORIZED));
};
