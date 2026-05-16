import { describe, expect, it } from "bun:test";
import { Effect, ManagedRuntime } from "effect";
import type { CollectionId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { importIcs } from "./import-ics.ts";

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:event-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260201T100000Z
DTEND:20260201T110000Z
SUMMARY:First
END:VEVENT
BEGIN:VEVENT
UID:event-2@test
DTSTAMP:20260101T000000Z
DTSTART:20260202T100000Z
DTEND:20260202T110000Z
SUMMARY:Second
END:VEVENT
END:VCALENDAR
`;

const REIMPORT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:event-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260201T100000Z
DTEND:20260201T110000Z
SUMMARY:First (updated)
END:VEVENT
BEGIN:VEVENT
UID:event-3@test
DTSTAMP:20260101T000000Z
DTSTART:20260203T100000Z
DTEND:20260203T110000Z
SUMMARY:Third
END:VEVENT
END:VCALENDAR
`;

const setupAlice = Effect.gen(function* () {
	const prov = yield* ProvisioningService;
	const alice = yield* prov
		.provisionUser({
			email: Email("alice@example.com"),
			name: "Alice",
			slug: Slug("alice"),
		})
		.pipe(Effect.orDie);
	return alice.calendar.id as CollectionId;
});

describe("importIcs (integration)", () => {
	it("inserts new events on first import", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const calendarId = await runtime.runPromise(setupAlice);
			const result = await runtime.runPromise(
				importIcs(calendarId, SAMPLE_ICS, "skip"),
			);
			expect(result.inserted).toBe(2);
			expect(result.skipped).toBe(0);
			expect(result.merged).toBe(0);
		} finally {
			await runtime.dispose();
		}
	});

	it("error mode aborts on conflict, no rows written", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const calendarId = await runtime.runPromise(setupAlice);
			await runtime.runPromise(importIcs(calendarId, SAMPLE_ICS, "skip"));
			const result = await runtime.runPromise(
				importIcs(calendarId, REIMPORT_ICS, "error"),
			);
			expect(result.inserted).toBe(0);
			expect(result.merged).toBe(0);
			expect(result.conflicts).toEqual(["event-1@test"]);
		} finally {
			await runtime.dispose();
		}
	});

	it("skip mode imports new events only", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const calendarId = await runtime.runPromise(setupAlice);
			await runtime.runPromise(importIcs(calendarId, SAMPLE_ICS, "skip"));
			const result = await runtime.runPromise(
				importIcs(calendarId, REIMPORT_ICS, "skip"),
			);
			expect(result.inserted).toBe(1);
			expect(result.skipped).toBe(1);
			expect(result.merged).toBe(0);
		} finally {
			await runtime.dispose();
		}
	});

	it("merge mode replaces existing events by UID", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const calendarId = await runtime.runPromise(setupAlice);
			await runtime.runPromise(importIcs(calendarId, SAMPLE_ICS, "skip"));
			const result = await runtime.runPromise(
				importIcs(calendarId, REIMPORT_ICS, "merge"),
			);
			expect(result.inserted).toBe(1);
			expect(result.merged).toBe(1);
			expect(result.skipped).toBe(0);
		} finally {
			await runtime.dispose();
		}
	});
});
