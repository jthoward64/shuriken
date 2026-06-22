import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime } from "effect";
import type { CollectionId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { exportCalendarToIcs } from "#src/services/cal-edit/export-ics.ts";
import { importIcs } from "#src/services/cal-edit/import-ics.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";

// ---------------------------------------------------------------------------
// Round-trip: import → export should preserve UIDs and SUMMARYs.
// Property values may be re-normalised (line folding, ordering) so we compare
// the multiset of (UID, SUMMARY) pairs rather than the raw byte stream.
// ---------------------------------------------------------------------------

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:e1@test
DTSTAMP:20260101T000000Z
DTSTART:20260601T100000Z
DTEND:20260601T110000Z
SUMMARY:First event
END:VEVENT
BEGIN:VEVENT
UID:e2@test
DTSTAMP:20260101T000000Z
DTSTART:20260602T100000Z
DTEND:20260602T110000Z
SUMMARY:Second event
END:VEVENT
END:VCALENDAR
`;

const extractPairs = (body: string): Array<[string, string]> => {
	const pairs: Array<[string, string]> = [];
	const lines = body.split(/\r?\n/);
	let currentUid: string | null = null;
	let currentSummary: string | null = null;
	let inVevent = false;
	for (const line of lines) {
		if (line.startsWith("BEGIN:VEVENT")) {
			inVevent = true;
			currentUid = null;
			currentSummary = null;
			continue;
		}
		if (line.startsWith("END:VEVENT")) {
			if (currentUid !== null && currentSummary !== null) {
				pairs.push([currentUid, currentSummary]);
			}
			inVevent = false;
			continue;
		}
		if (!inVevent) {
			continue;
		}
		if (line.startsWith("UID:")) {
			currentUid = line.slice(4);
		} else if (line.startsWith("SUMMARY:")) {
			currentSummary = line.slice(8);
		}
	}
	return pairs.sort();
};

describe("import → export round-trip (integration)", () => {
	it("preserves UIDs and SUMMARYs through the codec pipeline", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const calendarId = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const alice = yield* prov
						.provisionUser({
							email: Email("alice@example.com"),
							name: "Alice",
							slug: Slug("alice"),
						})
						.pipe(Effect.orDie);
					return alice.calendar.id as CollectionId;
				}),
			);

			await runtime.runPromise(importIcs(calendarId, ICS, "skip"));
			const exported = await runtime.runPromise(
				exportCalendarToIcs(calendarId),
			);

			expect(extractPairs(exported)).toEqual([
				["e1@test", "First event"],
				["e2@test", "Second event"],
			]);
		} finally {
			await runtime.dispose();
		}
	});
});
