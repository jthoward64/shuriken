import { Effect, Layer, Redacted } from "effect";
import { CryptoService } from "#src/platform/crypto.ts";

// ---------------------------------------------------------------------------
// TestCryptoLayer
//
// Identity-based crypto — no real password hashing.
// hashPassword prepends "test:" so verifyPassword can validate without argon2.
// ---------------------------------------------------------------------------

const TEST_HASH_PREFIX = "test:";

export const TestCryptoLayer = Layer.succeed(CryptoService, {
	hashPassword: (plain) =>
		Effect.succeed(
			Redacted.make(`${TEST_HASH_PREFIX}${Redacted.value(plain)}`),
		),
	verifyPassword: (plain, hash) =>
		Effect.succeed(
			Redacted.value(hash) === `${TEST_HASH_PREFIX}${Redacted.value(plain)}`,
		),
});
