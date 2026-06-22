import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime, Option } from "effect";
import { authenticateProxy } from "#src/auth/layers/proxy.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";

// ---------------------------------------------------------------------------
// authenticateProxy auto-provision integration
// ---------------------------------------------------------------------------

describe("authenticateProxy auto-provision", () => {
	it("creates user on first hit and finds them on second hit", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const headers = new Headers({
				"X-Remote-User": "newbie@example.com",
			});
			const provisionOpts = Option.some({
				autoProvision: true,
				roleHeader: Option.none<string>(),
			});

			const first = await runtime.runPromise(
				authenticateProxy(
					headers,
					Option.some("127.0.0.1"),
					"X-Remote-User",
					"*",
					provisionOpts,
				).pipe(Effect.orDie),
			);
			expect(first._tag).toBe("Authenticated");

			const second = await runtime.runPromise(
				authenticateProxy(
					headers,
					Option.some("127.0.0.1"),
					"X-Remote-User",
					"*",
					provisionOpts,
				).pipe(Effect.orDie),
			);
			expect(second._tag).toBe("Authenticated");
		} finally {
			await runtime.dispose();
		}
	});

	it("returns Unauthenticated when autoProvision is off and user missing", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const headers = new Headers({
				"X-Remote-User": "nobody@example.com",
			});
			const result = await runtime.runPromise(
				authenticateProxy(
					headers,
					Option.some("127.0.0.1"),
					"X-Remote-User",
					"*",
					Option.none(),
				).pipe(Effect.orDie),
			);
			expect(result._tag).toBe("Unauthenticated");
		} finally {
			await runtime.dispose();
		}
	});

	it("skips auto-provision when client IP is not trusted", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const headers = new Headers({
				"X-Remote-User": "outsider@example.com",
			});
			const result = await runtime.runPromise(
				authenticateProxy(
					headers,
					Option.some("9.9.9.9"),
					"X-Remote-User",
					"10.0.0.0/8",
					Option.some({
						autoProvision: true,
						roleHeader: Option.none(),
					}),
				).pipe(Effect.orDie),
			);
			expect(result._tag).toBe("Unauthenticated");
		} finally {
			await runtime.dispose();
		}
	});
});
