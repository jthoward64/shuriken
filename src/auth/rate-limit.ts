import type { Temporal } from "temporal-polyfill";

// ---------------------------------------------------------------------------
// Fixed-window rate limiting for failed auth attempts. Pure — no I/O; the
// caller (composite.ts) holds the state in a `Ref` and supplies `now` via
// Temporal so this stays testable without wall-clock dependence.
//
// Bucketed per key (client IP) so one abusive client can't lock out others.
// `recordFailure` also prunes buckets whose window has long expired, so the
// map doesn't grow unboundedly under a distributed-IP attack.
// ---------------------------------------------------------------------------

interface Bucket {
	readonly count: number;
	readonly windowStart: Temporal.Instant;
}

export interface RateLimitState {
	readonly buckets: ReadonlyMap<string, Bucket>;
}

export const emptyRateLimitState: RateLimitState = { buckets: new Map() };

export interface RateLimitConfig {
	readonly maxAttempts: number;
	readonly windowSeconds: number;
}

const PRUNE_WINDOW_MULTIPLIER = 2;

const elapsedSeconds = (from: Temporal.Instant, to: Temporal.Instant): number =>
	from.until(to, { largestUnit: "seconds" }).seconds;

/** True if `key` has hit `config.maxAttempts` failures within the current window. */
export const isRateLimited = (
	state: RateLimitState,
	key: string,
	now: Temporal.Instant,
	config: RateLimitConfig,
): boolean => {
	const bucket = state.buckets.get(key);
	if (!bucket) {
		return false;
	}
	if (elapsedSeconds(bucket.windowStart, now) > config.windowSeconds) {
		return false;
	}
	return bucket.count >= config.maxAttempts;
};

/** Records one failed attempt for `key`, returning the updated state. */
export const recordFailure = (
	state: RateLimitState,
	key: string,
	now: Temporal.Instant,
	config: RateLimitConfig,
): RateLimitState => {
	const next = new Map<string, Bucket>();
	for (const [k, b] of state.buckets) {
		if (
			k === key ||
			elapsedSeconds(b.windowStart, now) <=
				config.windowSeconds * PRUNE_WINDOW_MULTIPLIER
		) {
			next.set(k, b);
		}
	}
	const existing = next.get(key);
	next.set(
		key,
		!existing ||
			elapsedSeconds(existing.windowStart, now) > config.windowSeconds
			? { count: 1, windowStart: now }
			: { count: existing.count + 1, windowStart: existing.windowStart },
	);
	return { buckets: next };
};
