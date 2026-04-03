import { describe, expect, it } from "bun:test";
import { Effect, Redacted } from "effect";
import { CryptoService, CryptoServiceLive } from "./crypto.ts";

// ---------------------------------------------------------------------------
// CryptoServiceLive — smoke tests for the real Bun.password delegation
// ---------------------------------------------------------------------------

describe("CryptoServiceLive", () => {
	it("hash + verify roundtrip: correct password returns true", async () => {
		const result = await Effect.runPromise(
			CryptoService.pipe(
				Effect.flatMap((c) =>
					Effect.gen(function* () {
						const hash = yield* c.hashPassword(Redacted.make("secret"));
						return yield* c.verifyPassword(Redacted.make("secret"), hash);
					}),
				),
				Effect.provide(CryptoServiceLive),
				Effect.orDie,
			),
		);

		expect(result).toBe(true);
	});

	it("wrong password returns false", async () => {
		const result = await Effect.runPromise(
			CryptoService.pipe(
				Effect.flatMap((c) =>
					Effect.gen(function* () {
						const hash = yield* c.hashPassword(Redacted.make("secret"));
						return yield* c.verifyPassword(Redacted.make("wrong"), hash);
					}),
				),
				Effect.provide(CryptoServiceLive),
				Effect.orDie,
			),
		);

		expect(result).toBe(false);
	});
});
