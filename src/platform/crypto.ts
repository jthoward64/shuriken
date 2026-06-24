import { Context, Effect, Layer, Redacted } from "effect";
import { argon2id, argon2Verify } from "hash-wasm";
import { InternalError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// CryptoService — password hashing / verification.
//
// Uses argon2id via hash-wasm (a portable WASM implementation) so the adapter
// has no runtime-specific dependency. Hashes are emitted as PHC-format encoded
// strings (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`), which argon2Verify
// parses back, so parameters travel with the hash.
//
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

export class CryptoService extends Context.Service<
	CryptoService,
	CryptoServiceShape
>()("CryptoService") {}

// ---------------------------------------------------------------------------
// argon2id parameters — OWASP-recommended defaults (64 MiB, t=3, p=1).
// ---------------------------------------------------------------------------

const SALT_BYTES = 16;
const HASH_LENGTH = 32;
const ITERATIONS = 3;
const PARALLELISM = 1;
const MEMORY_KIB = 65536; // 64 MiB

const makeSalt = (): Uint8Array => {
	const salt = new Uint8Array(SALT_BYTES);
	crypto.getRandomValues(salt);
	return salt;
};

// ---------------------------------------------------------------------------
// Live implementation — argon2id via hash-wasm
// ---------------------------------------------------------------------------

export const CryptoServiceLive = Layer.succeed(CryptoService, {
	hashPassword: (plain) =>
		Effect.tryPromise({
			try: () =>
				argon2id({
					password: Redacted.value(plain),
					salt: makeSalt(),
					parallelism: PARALLELISM,
					iterations: ITERATIONS,
					memorySize: MEMORY_KIB,
					hashLength: HASH_LENGTH,
					outputType: "encoded",
				}).then(Redacted.make),
			catch: (e) => new InternalError({ cause: e }),
		}),

	verifyPassword: (plain, hash) =>
		Effect.tryPromise({
			try: () =>
				argon2Verify({
					password: Redacted.value(plain),
					hash: Redacted.value(hash),
				}),
			catch: (e) => new InternalError({ cause: e }),
		}),
});
