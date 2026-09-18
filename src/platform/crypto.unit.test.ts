import { expect } from "@std/expect";
import { beforeAll, describe, it } from "@std/testing/bdd";
import { Effect, Redacted } from "effect";
import {
	CryptoService,
	CryptoServiceLive,
	type CryptoServiceShape,
} from "./crypto.ts";

// ---------------------------------------------------------------------------
// CryptoServiceLive — smoke tests for the real argon2id delegation
// ---------------------------------------------------------------------------

describe("CryptoServiceLive", () => {
	// The live layer is provided once here, so the tests below hold the service
	// itself rather than re-assembling dependencies per case.
	let service: CryptoServiceShape;

	beforeAll(async () => {
		service = await Effect.provide(CryptoService, CryptoServiceLive).pipe(
			Effect.runPromise,
		);
	});

	it("hash + verify roundtrip: correct password returns true", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const hash = yield* service.hashPassword(Redacted.make("secret"));
				return yield* service.verifyPassword(Redacted.make("secret"), hash);
			}).pipe(Effect.orDie),
		);

		expect(result).toBe(true);
	});

	it("wrong password returns false", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const hash = yield* service.hashPassword(Redacted.make("secret"));
				return yield* service.verifyPassword(Redacted.make("wrong"), hash);
			}).pipe(Effect.orDie),
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
			Effect.gen(function* () {
				const hash = yield* service.hashPassword(Redacted.make("secret"));
				// Alternate correct/incorrect guesses run concurrently.
				return yield* Effect.all(
					Array.from({ length: attempts }, (_, i) =>
						service.verifyPassword(
							Redacted.make(i % 2 === 0 ? "secret" : "wrong"),
							hash,
						),
					),
					{ concurrency: "unbounded" },
				);
			}).pipe(Effect.orDie),
		);

		const expected = Array.from({ length: attempts }, (_, i) => i % 2 === 0);
		expect(results).toEqual(expected);
	});

	// The verified-credential cache must never let a wrong password reuse a
	// successful hit cached for the correct one.
	it("cache does not let a wrong password reuse a cached success", async () => {
		const [first, cachedHit, wrong] = await Effect.runPromise(
			Effect.gen(function* () {
				const hash = yield* service.hashPassword(Redacted.make("secret"));
				const a = yield* service.verifyPassword(Redacted.make("secret"), hash);
				const b = yield* service.verifyPassword(Redacted.make("secret"), hash);
				const d = yield* service.verifyPassword(Redacted.make("wrong"), hash);
				return [a, b, d] as const;
			}).pipe(Effect.orDie),
		);

		expect(first).toBe(true);
		expect(cachedHit).toBe(true);
		expect(wrong).toBe(false);
	});
});
