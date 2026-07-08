import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Redacted } from "effect";
import { CryptoService, CryptoServiceLive } from "./crypto.ts";

// ---------------------------------------------------------------------------
// CryptoServiceLive — smoke tests for the real argon2id delegation
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

	// Regression: hash-wasm reuses one WASM instance whose buffer is not
	// concurrency-safe. Without serialisation, overlapping verifications return
	// wrong results — which broke DAV auth under iOS's parallel requests. Many
	// concurrent correct/incorrect verifications must each return the right
	// answer.
	it("concurrent verifications stay correct", async () => {
		const attempts = 24;
		const results = await Effect.runPromise(
			CryptoService.pipe(
				Effect.flatMap((c) =>
					Effect.gen(function* () {
						const hash = yield* c.hashPassword(Redacted.make("secret"));
						// Alternate correct/incorrect guesses run concurrently.
						return yield* Effect.all(
							Array.from({ length: attempts }, (_, i) =>
								c.verifyPassword(
									Redacted.make(i % 2 === 0 ? "secret" : "wrong"),
									hash,
								),
							),
							{ concurrency: "unbounded" },
						);
					}),
				),
				Effect.provide(CryptoServiceLive),
				Effect.orDie,
			),
		);

		const expected = Array.from({ length: attempts }, (_, i) => i % 2 === 0);
		expect(results).toEqual(expected);
	});

	// The verified-credential cache must never let a wrong password reuse a
	// successful hit cached for the correct one.
	it("cache does not let a wrong password reuse a cached success", async () => {
		const [first, cachedHit, wrong] = await Effect.runPromise(
			CryptoService.pipe(
				Effect.flatMap((c) =>
					Effect.gen(function* () {
						const hash = yield* c.hashPassword(Redacted.make("secret"));
						const a = yield* c.verifyPassword(Redacted.make("secret"), hash);
						const b = yield* c.verifyPassword(Redacted.make("secret"), hash);
						const d = yield* c.verifyPassword(Redacted.make("wrong"), hash);
						return [a, b, d] as const;
					}),
				),
				Effect.provide(CryptoServiceLive),
				Effect.orDie,
			),
		);

		expect(first).toBe(true);
		expect(cachedHit).toBe(true);
		expect(wrong).toBe(false);
	});
});
