import { describe, expect, it } from "bun:test";
import "temporal-polyfill/global";
import { extractInstantFromUuidV7 } from "./ids.ts";

// ---------------------------------------------------------------------------
// extractInstantFromUuidV7
// ---------------------------------------------------------------------------

// Known UUIDv7 timestamp: 0x018e5b0d1234 = 1710000000564 ms since Unix epoch
const KNOWN_UUID_MS = 0x018e5b0d1234;
// Max 48-bit value: all f's = 281474976710655
const MAX_TIMESTAMP_MS = 0xffffffffffff;

describe("extractInstantFromUuidV7", () => {
	it("extracts the correct timestamp from a known UUIDv7", () => {
		// UUIDv7 format: tttttttt-tttt-7xxx-xxxx-xxxxxxxxxxxx
		// First 12 hex chars are the 48-bit millisecond timestamp.
		const uuid = "018e5b0d-1234-7abc-8000-000000000000";
		const instant = extractInstantFromUuidV7(uuid);
		expect(instant.epochMilliseconds).toBe(KNOWN_UUID_MS);
	});

	it("returns epoch 0 for a UUID with all-zero timestamp", () => {
		const uuid = "00000000-0000-7000-8000-000000000000";
		const instant = extractInstantFromUuidV7(uuid);
		expect(instant.epochMilliseconds).toBe(0);
	});

	it("preserves millisecond monotonicity: earlier UUID → earlier timestamp", () => {
		// Generate two UUIDv7s with known timestamps
		const earlier = "018e5b0d-0000-7000-8000-000000000000";
		const later = "018e5b0d-0001-7000-8000-000000000000";

		const t1 = extractInstantFromUuidV7(earlier).epochMilliseconds;
		const t2 = extractInstantFromUuidV7(later).epochMilliseconds;

		expect(t1).toBeLessThan(t2);
	});

	it("handles max timestamp prefix", () => {
		const uuid = "ffffffff-ffff-7000-8000-000000000000";
		const instant = extractInstantFromUuidV7(uuid);
		expect(instant.epochMilliseconds).toBe(MAX_TIMESTAMP_MS);
	});
});
