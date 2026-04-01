import type { Option } from "effect";
import { Context } from "effect";
import type { AuthError, DatabaseError } from "#src/domain/errors.ts";
import type { AuthResult } from "#src/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// AuthService — authenticates an HTTP request and produces an AuthResult.
//
// Concrete implementations live in auth/layers/ and are selected at startup
// based on the AUTH_MODE env var. Business logic never imports a concrete
// auth implementation — it depends only on this tag.
// ---------------------------------------------------------------------------

export interface AuthServiceShape {
	/**
	 * Authenticate the incoming request.
	 *
	 * @param headers  Request headers (for Basic / Proxy auth parsing)
	 * @param clientIp Remote client IP address (for trusted-proxy checking in proxy mode)
	 */
	readonly authenticate: (
		headers: Headers,
		clientIp: Option.Option<string>,
	) => import("effect").Effect.Effect<AuthResult, AuthError | DatabaseError>;
}

export class AuthService extends Context.Tag("AuthService")<
	AuthService,
	AuthServiceShape
>() {}
