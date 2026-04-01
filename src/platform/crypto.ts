import { Context, Effect, Layer } from "effect";
import { InternalError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// CryptoService — password hashing / verification
// Wraps Bun.password so business logic never imports Bun directly.
// ---------------------------------------------------------------------------

export interface CryptoServiceShape {
	readonly hashPassword: (
		plain: string,
	) => Effect.Effect<string, InternalError>;
	readonly verifyPassword: (
		plain: string,
		hash: string,
	) => Effect.Effect<boolean, InternalError>;
}

export class CryptoService extends Context.Tag("CryptoService")<
	CryptoService,
	CryptoServiceShape
>() {}

// ---------------------------------------------------------------------------
// Live implementation — wraps Bun.password
// ---------------------------------------------------------------------------

export const CryptoServiceLive = Layer.succeed(CryptoService, {
	hashPassword: (plain) =>
		Effect.tryPromise({
			try: () => Bun.password.hash(plain),
			catch: (e) => new InternalError({ cause: e }),
		}),

	verifyPassword: (plain, hash) =>
		Effect.tryPromise({
			try: () => Bun.password.verify(plain, hash),
			catch: (e) => new InternalError({ cause: e }),
		}),
});
