import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
	get,
	propfind,
	put,
	twoUsers,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";
import type { ScriptStepResult } from "#src/testing/script-runner/types.ts";

// ---------------------------------------------------------------------------
// Schedule-Tag stability across an attendee PARTSTAT-only update — RFC 6638
// §3.2.10 (Organizer rule 1 / Attendee rule 2) and §8.2.
//
// This mirrors caldav-server-tester's `scheduling.schedule-tag.stable-partstat`
// probe:
//   1. alice (organizer) saves an event inviting bob. The server auto-places a
//      scheduling object resource into bob's default calendar (RFC 6638 §3.4.2).
//   2. That auto-placed copy MUST be a real SOR — it carries a Schedule-Tag,
//      returned both as the GET `Schedule-Tag` header (§8.2) and the
//      CALDAV:schedule-tag PROPFIND property (§9.3).
//   3. bob changes only his own PARTSTAT (an RSVP) and PUTs the copy back. The
//      Schedule-Tag MUST stay stable — an attendee's participation-status change
//      is "inconsequential" and must not invalidate other attendees'
//      If-Schedule-Tag-Match conditional requests.
// ---------------------------------------------------------------------------

const ALICE_CAL = "/dav/principals/alice/cal/primary/";
const BOB_CAL = "/dav/principals/bob/cal/primary/";

const PROBE_UID = "schedule-tag-stable-probe@example.com";

const invite = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//test//EN",
	"BEGIN:VEVENT",
	`UID:${PROBE_UID}`,
	"DTSTART:20300601T100000Z",
	"DTEND:20300601T110000Z",
	"SUMMARY:schedule-tag stability probe",
	"ORGANIZER:mailto:alice@example.com",
	"ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:alice@example.com",
	"ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:bob@example.com",
	"END:VEVENT",
	"END:VCALENDAR",
	"",
].join("\r\n");

// PROPFIND requesting the schedule-tag property on the calendar's members.
const PROPFIND_SCHEDULE_TAG = [
	'<?xml version="1.0" encoding="utf-8"?>',
	'<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">',
	"  <D:prop><C:schedule-tag/><D:getetag/></D:prop>",
	"</D:propfind>",
].join("\n");

/**
 * Pull the first `.ics` member href out of a PROPFIND multistatus body and
 * return just its path (the server returns absolute hrefs; the script runner
 * wants a path). Percent-encoding (e.g. `%40` for `@`) is preserved.
 */
const firstIcsHref = (body: string): string | undefined => {
	const href = body.match(
		/<[A-Za-z]*:?href>([^<]*\.ics)<\/[A-Za-z]*:?href>/,
	)?.[1];
	if (href === undefined) {
		return undefined;
	}
	return href.startsWith("http") ? new URL(href).pathname : href;
};

/** Flip bob's ATTENDEE PARTSTAT to ACCEPTED, leaving everything else intact. */
const acceptAsBob = (body: string): string =>
	body
		.split(/\r?\n/)
		.map((line) =>
			line.includes("bob@example.com") && line.includes("PARTSTAT=")
				? line.replace(/PARTSTAT=[A-Z-]+/, "PARTSTAT=ACCEPTED")
				: line,
		)
		.join("\r\n");

describe("Schedule-Tag stability on attendee PARTSTAT update (RFC 6638 §3.2.10)", () => {
	it("keeps the Schedule-Tag stable when an attendee changes only PARTSTAT", async () => {
		const results = await runScript(
			[
				// 1. Organizer invites bob → auto-placement into bob's calendar.
				put(`${ALICE_CAL}probe.ics`, invite, "text/calendar; charset=utf-8", {
					as: "alice",
					expect: { status: 201 },
				}),

				// 2. Discover bob's auto-placed copy and assert it exposes a
				//    schedule-tag property.
				propfind(BOB_CAL, PROPFIND_SCHEDULE_TAG, {
					as: "bob",
					headers: { Depth: "1" },
					expect: { status: 207, bodyContains: ["schedule-tag", ".ics"] },
				}),

				// 3. GET the auto-placed copy → capture tag_before from the header.
				(prev: ReadonlyArray<ScriptStepResult>) => {
					const href = firstIcsHref(prev[1]?.body ?? "");
					return get(href ?? `${BOB_CAL}missing.ics`, {
						as: "bob",
						name: "GET bob's auto-placed copy",
						expect: { status: 200 },
					});
				},

				// 4. bob accepts (PARTSTAT-only) and PUTs back with a conditional
				//    If-Schedule-Tag-Match → capture tag_after from the header.
				(prev: ReadonlyArray<ScriptStepResult>) => {
					const getStep = prev[2];
					const href = getStep?.step.path ?? `${BOB_CAL}missing.ics`;
					const tagBefore = getStep?.headers["schedule-tag"] ?? "";
					return put(
						href,
						acceptAsBob(getStep?.body ?? ""),
						"text/calendar; charset=utf-8",
						{
							as: "bob",
							name: "PUT bob's PARTSTAT=ACCEPTED",
							headers: { "If-Schedule-Tag-Match": tagBefore },
							expect: { status: 204 },
						},
					);
				},
			],
			twoUsers(),
		);

		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}

		const tagBefore = results[2]?.headers["schedule-tag"];
		const tagAfter = results[3]?.headers["schedule-tag"];

		// The auto-placed SOR must carry a Schedule-Tag (else the probe is "unknown").
		expect(tagBefore, "GET should return a Schedule-Tag header").toBeTruthy();
		// And it must not change across a PARTSTAT-only update.
		expect(tagAfter, "PUT should return a Schedule-Tag header").toBeTruthy();
		expect(tagAfter, "Schedule-Tag must be stable across PARTSTAT change").toBe(
			tagBefore,
		);
	});

	it("auto-applies an attendee REPLY to the organizer's copy without changing its Schedule-Tag", async () => {
		const results = await runScript(
			[
				// 1. Organizer invites bob. The PUT response carries the organizer
				//    copy's Schedule-Tag.
				put(`${ALICE_CAL}probe.ics`, invite, "text/calendar; charset=utf-8", {
					as: "alice",
					expect: { status: 201 },
				}),

				// 2. bob discovers + GETs his auto-placed copy.
				propfind(BOB_CAL, PROPFIND_SCHEDULE_TAG, {
					as: "bob",
					headers: { Depth: "1" },
					expect: { status: 207 },
				}),
				(prev: ReadonlyArray<ScriptStepResult>) =>
					get(firstIcsHref(prev[1]?.body ?? "") ?? `${BOB_CAL}missing.ics`, {
						as: "bob",
						name: "GET bob's auto-placed copy",
						expect: { status: 200 },
					}),

				// 3. bob accepts → server delivers a REPLY to alice and auto-applies it.
				(prev: ReadonlyArray<ScriptStepResult>) => {
					const getStep = prev[2];
					return put(
						getStep?.step.path ?? `${BOB_CAL}missing.ics`,
						acceptAsBob(getStep?.body ?? ""),
						"text/calendar; charset=utf-8",
						{
							as: "bob",
							name: "PUT bob's PARTSTAT=ACCEPTED",
							expect: { status: 204 },
						},
					);
				},

				// 4. The organizer's copy now reflects bob's ACCEPTED status.
				get(`${ALICE_CAL}probe.ics`, {
					as: "alice",
					name: "GET organizer copy after reply",
					expect: { status: 200 },
				}),
			],
			twoUsers(),
		);

		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}

		const organizerTagBefore = results[0]?.headers["schedule-tag"];
		const organizerCopy = results[4]?.body ?? "";
		const organizerTagAfter = results[4]?.headers["schedule-tag"];

		// The organizer's copy must now carry bob's accepted status (RFC 6638 §4.2).
		// Unfold iCalendar continuation lines (RFC 5545 §3.1) before matching.
		const bobLine = organizerCopy
			.replace(/\r?\n[ \t]/g, "")
			.split(/\r?\n/)
			.find((l) => l.includes("bob@example.com"));
		expect(bobLine, "organizer copy should still list bob").toBeTruthy();
		expect(bobLine).toContain("PARTSTAT=ACCEPTED");
		expect(bobLine).toContain("SCHEDULE-STATUS=2.0");

		// And the organizer's Schedule-Tag MUST be unchanged (§3.2.10 rule 1).
		expect(
			organizerTagBefore,
			"organizer PUT returned a Schedule-Tag",
		).toBeTruthy();
		expect(
			organizerTagAfter,
			"organizer Schedule-Tag must survive an auto-applied reply",
		).toBe(organizerTagBefore);
	});

	// -------------------------------------------------------------------------
	// Attendee rule 2 (§3.2.10): an Organizer REQUEST that changes ONLY
	// participation status must not change the Attendee's Schedule-Tag, but a
	// substantive change must.
	// -------------------------------------------------------------------------

	// Re-invite carrying a PARTSTAT-only change (bob now ACCEPTED).
	const reinvitePartstatOnly = acceptAsBob(invite);
	// Re-invite carrying a consequential change (different SUMMARY).
	const reinviteConsequential = invite.replace(
		"SUMMARY:schedule-tag stability probe",
		"SUMMARY:rescheduled probe",
	);

	// Steps shared by both rule-2 cases: invite bob, then read his auto-placed
	// copy's path + tag. The re-PUT body for step 4 is the only difference.
	const rule2Steps = (rePutBody: string) => [
		put(`${ALICE_CAL}probe.ics`, invite, "text/calendar; charset=utf-8", {
			as: "alice",
			expect: { status: 201 },
		}),
		propfind(BOB_CAL, PROPFIND_SCHEDULE_TAG, {
			as: "bob",
			headers: { Depth: "1" },
			expect: { status: 207 },
		}),
		(prev: ReadonlyArray<ScriptStepResult>) =>
			get(firstIcsHref(prev[1]?.body ?? "") ?? `${BOB_CAL}missing.ics`, {
				as: "bob",
				name: "GET bob's copy (before)",
				expect: { status: 200 },
			}),
		// 4. Organizer re-PUTs — either a PARTSTAT-only or a consequential change.
		put(`${ALICE_CAL}probe.ics`, rePutBody, "text/calendar; charset=utf-8", {
			as: "alice",
			name: "organizer re-PUT",
			expect: { status: 204 },
		}),
		(prev: ReadonlyArray<ScriptStepResult>) =>
			get(prev[2]?.step.path ?? `${BOB_CAL}missing.ics`, {
				as: "bob",
				name: "GET bob's copy (after)",
				expect: { status: 200 },
			}),
	];

	it("keeps the attendee's Schedule-Tag stable when an organizer REQUEST changes only PARTSTAT (rule 2)", async () => {
		const results = await runScript(
			rule2Steps(reinvitePartstatOnly),
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}

		const tagBefore = results[2]?.headers["schedule-tag"];
		const tagAfter = results[4]?.headers["schedule-tag"];
		const copyAfter = (results[4]?.body ?? "").replace(/\r?\n[ \t]/g, "");

		// The update must have landed (bob's copy now reflects ACCEPTED)...
		const bobLine = copyAfter
			.split(/\r?\n/)
			.find((l) => l.includes("bob@example.com"));
		expect(bobLine).toContain("PARTSTAT=ACCEPTED");
		// ...but a PARTSTAT-only update must NOT change the Schedule-Tag.
		expect(tagBefore, "GET returned a Schedule-Tag").toBeTruthy();
		expect(
			tagAfter,
			"PARTSTAT-only organizer update must preserve the tag (rule 2)",
		).toBe(tagBefore);
	});

	it("changes the attendee's Schedule-Tag when an organizer REQUEST changes event content", async () => {
		const results = await runScript(
			rule2Steps(reinviteConsequential),
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}

		const tagBefore = results[2]?.headers["schedule-tag"];
		const tagAfter = results[4]?.headers["schedule-tag"];
		const copyAfter = results[4]?.body ?? "";

		// The consequential change landed...
		expect(copyAfter).toContain("rescheduled probe");
		// ...so the Schedule-Tag MUST change.
		expect(tagBefore, "GET returned a Schedule-Tag").toBeTruthy();
		expect(tagAfter, "PUT returned a Schedule-Tag").toBeTruthy();
		expect(
			tagAfter,
			"a consequential organizer update must mint a fresh tag",
		).not.toBe(tagBefore);
	});
});
