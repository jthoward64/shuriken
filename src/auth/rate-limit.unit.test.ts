import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Temporal } from "temporal-polyfill";
import {
	emptyRateLimitState,
	isRateLimited,
	recordFailure,
} from "./rate-limit.ts";

const config = { maxAttempts: 3, windowSeconds: 60 };
const t0 = Temporal.Instant.from("2026-01-01T00:00:00Z");
const secondsLater = (s: number) => t0.add({ seconds: s });

describe("auth rate limiting", () => {
	it("does not block a key with no recorded failures", () => {
		expect(isRateLimited(emptyRateLimitState, "1.2.3.4", t0, config)).toBe(
			false,
		);
	});

	it("blocks once maxAttempts failures land within the window", () => {
		let state = emptyRateLimitState;
		for (let i = 0; i < config.maxAttempts; i++) {
			state = recordFailure(state, "1.2.3.4", secondsLater(i), config);
		}
		expect(isRateLimited(state, "1.2.3.4", secondsLater(3), config)).toBe(true);
	});

	it("does not block a different key", () => {
		let state = emptyRateLimitState;
		for (let i = 0; i < config.maxAttempts; i++) {
			state = recordFailure(state, "1.2.3.4", secondsLater(i), config);
		}
		expect(isRateLimited(state, "5.6.7.8", secondsLater(3), config)).toBe(
			false,
		);
	});

	it("un-blocks once the window rolls over", () => {
		let state = emptyRateLimitState;
		for (let i = 0; i < config.maxAttempts; i++) {
			state = recordFailure(state, "1.2.3.4", secondsLater(i), config);
		}
		const later = secondsLater(config.windowSeconds + 1);
		expect(isRateLimited(state, "1.2.3.4", later, config)).toBe(false);
	});

	it("prunes long-stale buckets on recordFailure", () => {
		let state = recordFailure(emptyRateLimitState, "stale", t0, config);
		const muchLater = secondsLater(config.windowSeconds * 10);
		state = recordFailure(state, "fresh", muchLater, config);
		expect(state.buckets.has("stale")).toBe(false);
		expect(state.buckets.has("fresh")).toBe(true);
	});
});
