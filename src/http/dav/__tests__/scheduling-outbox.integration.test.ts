import { describe, expect, it } from "bun:test";
import { makeCalEvent } from "#src/testing/data.ts";
import { post, put, twoUsers } from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Scheduling outbox free-busy POST — RFC 6638 §6.2
//
// A calendar user POSTs a VFREEBUSY REQUEST to their scheduling outbox listing
// one or more ATTENDEEs. The server answers with a CALDAV:schedule-response
// (§6.2.2 / §10.2): one CALDAV:response per recipient carrying the recipient
// href, an iTIP request-status, and (when resolvable) the recipient's
// free-busy as calendar-data.
//
// Regression: shuriken previously (a) required the pre-standard
// Originator/Recipient HTTP headers and 400'd without them, and (b) returned a
// raw text/calendar VFREEBUSY instead of the schedule-response XML — both of
// which broke RFC 6638 clients (python-caldav). See
// documentation/planning/finding-outbox-freebusy.md.
// ---------------------------------------------------------------------------

// alice & bob are provisioned with a primary calendar + scheduling inbox/outbox.
const ALICE_OUTBOX = "/dav/principals/alice/outbox/outbox/";

// A busy block on bob's calendar that the free-busy query should surface.
const bobBusy = makeCalEvent({
	uid: "outbox-fb-bob@example.com",
	summary: "Bob is busy",
	dtstart: "20260610T140000Z",
	dtend: "20260610T150000Z",
});

const freeBusyRequest = (attendee: string) =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//test//EN",
		"METHOD:REQUEST",
		"BEGIN:VFREEBUSY",
		"UID:outbox-fb-probe@example.com",
		"DTSTAMP:20260601T000000Z",
		"DTSTART:20260610T000000Z",
		"DTEND:20260611T000000Z",
		"ORGANIZER:mailto:alice@example.com",
		`ATTENDEE:${attendee}`,
		"END:VFREEBUSY",
		"END:VCALENDAR",
		"",
	].join("\r\n");

describe("scheduling outbox free-busy POST (RFC 6638 §6.2)", () => {
	it("returns a schedule-response with the recipient's free-busy (no legacy headers needed)", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/bob/cal/primary/busy.ics",
					bobBusy,
					"text/calendar; charset=utf-8",
					{ as: "bob", expect: { status: 201 } },
				),
				post(ALICE_OUTBOX, freeBusyRequest("mailto:bob@example.com"), {
					as: "alice",
					expect: {
						status: 200,
						bodyContains: [
							"schedule-response",
							"<C:recipient><D:href>mailto:bob@example.com</D:href></C:recipient>",
							"2.0;Success",
							// bob's busy block falls inside the queried range.
							"FREEBUSY:20260610T140000Z/20260610T150000Z",
						],
					},
				}),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("reports request-status 3.7 for an unresolvable recipient", async () => {
		const results = await runScript(
			[
				post(ALICE_OUTBOX, freeBusyRequest("mailto:nobody@example.com"), {
					as: "alice",
					expect: {
						status: 200,
						bodyContains: [
							"<C:recipient><D:href>mailto:nobody@example.com</D:href></C:recipient>",
							"3.7;Invalid Calendar User",
						],
						bodyNotContains: ["FREEBUSY:"],
					},
				}),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
