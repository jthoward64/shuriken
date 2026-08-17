import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import {
	put,
	report,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// Regression: iOS/macOS emit a per-element `xmlns:` declaration on EVERY
// <href> in a calendar-multiget. fast-xml-parser then parses each href as an
// object (text under "#text") instead of a string, and extractHrefs used to
// drop them — so multiget returned an empty <multistatus/> and the client
// synced no events/contacts even though everything else (discovery, initial
// sync) worked.

const EVENT = makeCalEvent({
	uid: "ns-href@example.com",
	summary: "Per-element xmlns href",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

// Apple style (verified against a real iOS request): xmlns:A="DAV:" is declared
// only on <A:prop>, then the A: prefix is reused on the sibling <A:href>
// elements WITHOUT being in their scope — so the prefix doesn't resolve and the
// key stays "A:href" rather than "{DAV:}href".
const APPLE_MULTIGET = `<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-multiget xmlns:C="urn:ietf:params:xml:ns:caldav">
  <A:prop xmlns:A="DAV:"><A:getetag/><C:calendar-data/></A:prop>
  <A:href>/dav/principals/test/cal/primary/ns.ics</A:href>
</C:calendar-multiget>`;

describe("calendar-multiget with per-element xmlns on <href> (Apple style)", () => {
	it("resolves the href and returns calendar-data", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/ns.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				report("/dav/principals/test/cal/primary/", APPLE_MULTIGET, {
					as: "test",
					headers: { Depth: "1" },
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		for (const r of results) {
			expect(r.failures, r.step.name).toEqual([]);
		}
		const body = results[1]?.body ?? "";
		expect(body).toContain("/dav/principals/test/cal/primary/ns.ics");
		expect(body).toContain("BEGIN:VEVENT");
		expect(body).toContain("Per-element xmlns href");
	});
});

// KDE/Qt style (KDAV builds its DOM with createElementNS and no prefix, so Qt
// serialises a default `xmlns=` on every element). An href declaring its own
// default namespace parses to an object, and its text sits under the "#text"
// pseudo-key — which must survive Clark normalization unresolved.

const KDE_CAL_MULTIGET = `<?xml version="1.0" encoding="UTF-8"?>
<calendar-multiget xmlns="urn:ietf:params:xml:ns:caldav"><prop xmlns="DAV:"><getetag xmlns="DAV:"/><calendar-data xmlns="urn:ietf:params:xml:ns:caldav"/></prop><href xmlns="DAV:">/dav/principals/test/cal/primary/kde.ics</href></calendar-multiget>`;

describe("calendar-multiget with default-namespace <href> (KDE/Qt style)", () => {
	it("resolves the href and returns calendar-data", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/kde.ics",
					makeCalEvent({
						uid: "kde-href@example.com",
						summary: "Default namespace href",
						dtstart: "20260115T100000Z",
						dtend: "20260115T110000Z",
					}),
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				report("/dav/principals/test/cal/primary/", KDE_CAL_MULTIGET, {
					as: "test",
					headers: { Depth: "1" },
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		for (const r of results) {
			expect(r.failures, r.step.name).toEqual([]);
		}
		const body = results[1]?.body ?? "";
		expect(body).toContain("/dav/principals/test/cal/primary/kde.ics");
		expect(body).toContain("BEGIN:VEVENT");
		expect(body).toContain("Default namespace href");
	});
});

// Two sibling hrefs collapse to an array in fast-xml-parser — exercise that path
// alongside the default-namespace declaration KDAV puts on each one.
const KDE_CARD_MULTIGET = `<?xml version="1.0" encoding="UTF-8"?>
<addressbook-multiget xmlns="urn:ietf:params:xml:ns:carddav"><prop xmlns="DAV:"><getetag xmlns="DAV:"/><address-data xmlns="urn:ietf:params:xml:ns:carddav"><allprop xmlns="urn:ietf:params:xml:ns:carddav"/></address-data></prop><href xmlns="DAV:">/dav/principals/test/card/primary/kde-a.vcf</href><href xmlns="DAV:">/dav/principals/test/card/primary/kde-b.vcf</href></addressbook-multiget>`;

describe("addressbook-multiget with default-namespace <href> (KDE/Qt style)", () => {
	it("resolves every href in the array and returns address-data", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/kde-a.vcf",
					makeVCard({ uid: "kde-a@example.com", fn: "Ada Lovelace" }),
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/card/primary/kde-b.vcf",
					makeVCard({ uid: "kde-b@example.com", fn: "Grace Hopper" }),
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				report("/dav/principals/test/card/primary/", KDE_CARD_MULTIGET, {
					as: "test",
					headers: { Depth: "1" },
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		for (const r of results) {
			expect(r.failures, r.step.name).toEqual([]);
		}
		const body = results[2]?.body ?? "";
		expect(body).toContain("Ada Lovelace");
		expect(body).toContain("Grace Hopper");
	});
});
