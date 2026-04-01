import { Context, Effect, Layer, Redacted } from "effect";
import { InternalError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// CryptoService — password hashing / verification
// Wraps Bun.password so business logic never imports Bun directly.
// Passwords are accepted as Redacted<string> to prevent accidental logging.
// ---------------------------------------------------------------------------

export interface CryptoServiceShape {
	readonly hashPassword: (
		plain: Redacted.Redacted<string>,
	) => Effect.Effect<Redacted.Redacted<string>, InternalError>;
	readonly verifyPassword: (
		plain: Redacted.Redacted<string>,
		hash: Redacted.Redacted<string>,
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
			try: () => Bun.password.hash(Redacted.value(plain)).then(Redacted.make),
			catch: (e) => new InternalError({ cause: e }),
		}),

	verifyPassword: (plain, hash) =>
		Effect.tryPromise({
			try: () =>
				Bun.password.verify(Redacted.value(plain), Redacted.value(hash)),
			catch: (e) => new InternalError({ cause: e }),
		}),
});
