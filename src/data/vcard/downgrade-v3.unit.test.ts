import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { decodeVCard, encodeVCard } from "./codec.ts";
import { downgradeToV3 } from "./downgrade-v3.ts";
import { upgradeToV4 } from "./upgrade-v4.ts";

const vcard = (...lines: Array<string>) => `${lines.join("\r\n")}\r\n`;

// decode → downgrade → encode, returning the emitted lines (blank-trimmed)
const down = (text: string): Promise<Array<string>> =>
	Effect.runPromise(
		decodeVCard(text).pipe(
			Effect.map(downgradeToV3),
			Effect.flatMap(encodeVCard),
		),
	).then((out) =>
		out
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l !== ""),
	);

describe("downgradeToV3", () => {
	it("rewrites VERSION to 3.0 and PREF to a pref TYPE token", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Jane",
				"N:Doe;Jane;;;",
				"EMAIL;TYPE=work;PREF=1:jane@work.example",
				"END:VCARD",
			),
		);
		expect(lines[1]).toBe("VERSION:3.0");
		const email = lines.find((l) => l.startsWith("EMAIL"));
		expect(email).toContain("pref");
		expect(email).not.toContain("PREF=1");
	});

	it("retypes a urn:uuid UID to plain text", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Jane",
				"N:Doe;Jane;;;",
				"UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
				"END:VCARD",
			),
		);
		expect(lines).toContain("UID:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1");
	});

	it("maps KIND and MEMBER to Apple X-ADDRESSBOOKSERVER- properties", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Group",
				"N:Group;;;;",
				"KIND:group",
				"MEMBER:urn:uuid:11111111-1111-1111-1111-111111111111",
				"END:VCARD",
			),
		);
		expect(lines).toContain("X-ADDRESSBOOKSERVER-KIND:group");
		expect(lines).toContain(
			"X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:11111111-1111-1111-1111-111111111111",
		);
		expect(lines.some((l) => l.startsWith("KIND"))).toBe(false);
		expect(lines.some((l) => l.startsWith("MEMBER"))).toBe(false);
	});

	it("maps ANNIVERSARY to a grouped X-ABDATE/X-ABLABEL pair", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Jane",
				"N:Doe;Jane;;;",
				"ANNIVERSARY:2010-06-15",
				"END:VCARD",
			),
		);
		const abdate = lines.find((l) => l.includes("X-ABDATE"));
		const ablabel = lines.find((l) => l.includes("X-ABLABEL"));
		expect(abdate).toContain("20100615");
		expect(ablabel).toContain("_$!<Anniversary>!$_");
		// both share the same item group
		expect(abdate?.split(".")[0]).toBe(ablabel?.split(".")[0]);
		expect(lines.some((l) => l.startsWith("ANNIVERSARY"))).toBe(false);
	});

	it("maps GENDER to X-GENDER and geo: URI to structured GEO", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Jane",
				"N:Doe;Jane;;;",
				"GENDER:F",
				"GEO:geo:37.386,-122.083",
				"END:VCARD",
			),
		);
		expect(lines).toContain("X-GENDER:F");
		expect(lines).toContain("GEO:37.386;-122.083");
	});

	it("splits an ADR LABEL= param back into a standalone LABEL property", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Jane",
				"N:Doe;Jane;;;",
				"ADR;TYPE=home;LABEL=123 Main St:;;123 Main St;City;;;",
				"END:VCARD",
			),
		);
		const adr = lines.find((l) => l.startsWith("ADR"));
		expect(adr).not.toContain("LABEL=");
		expect(lines.some((l) => l.startsWith("LABEL"))).toBe(true);
	});

	it("strips 4.0-only VALUE params (TEL uri, TZ utc-offset, date-and-or-time)", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Jane",
				"N:Doe;Jane;;;",
				"TEL;VALUE=uri:tel:+15550100",
				"TZ;VALUE=utc-offset:-0500",
				"BDAY;VALUE=date-and-or-time:--0401",
				"END:VCARD",
			),
		);
		expect(lines).toContain("TEL:+15550100");
		expect(lines).toContain("TZ:-0500");
		expect(lines.some((l) => l.includes("VALUE="))).toBe(false);
	});

	it("synthesizes N from FN when N is absent", async () => {
		const lines = await down(
			vcard("BEGIN:VCARD", "VERSION:4.0", "FN:Jane Doe", "END:VCARD"),
		);
		expect(lines).toContain("N:Jane Doe;;;;");
	});

	it("drops a geo: URI altitude (3.0 GEO has only lat;lon)", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Jane",
				"N:Doe;Jane;;;",
				"GEO:geo:1.5,-2.5,100",
				"END:VCARD",
			),
		);
		expect(lines).toContain("GEO:1.5;-2.5");
	});

	it("gives each ANNIVERSARY a distinct, non-colliding item group", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Jane",
				"N:Doe;Jane;;;",
				"item1.X-ABLABEL:_$!<Custom>!$_",
				"ANNIVERSARY:2010-06-15",
				"END:VCARD",
			),
		);
		const abdate = lines.find((l) => l.includes("X-ABDATE"));
		// must not collide with the pre-existing item1 group
		expect(abdate?.startsWith("item1.")).toBe(false);
		expect(abdate).toContain("20100615");
	});

	it("does not crash on an empty card and stamps VERSION:3.0", async () => {
		const lines = await down(vcard("BEGIN:VCARD", "END:VCARD"));
		expect(lines[1]).toBe("VERSION:3.0");
	});

	it("leaves a VALUE=uri param on a non-TEL property and a LABEL-less ADR alone", async () => {
		const lines = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Jane",
				"N:Doe;Jane;;;",
				"URL;VALUE=uri:https://example.com",
				"ADR;TYPE=home:;;123 Main St;City;;;",
				"END:VCARD",
			),
		);
		expect(lines.some((l) => l.startsWith("URL"))).toBe(true);
		const adr = lines.find((l) => l.startsWith("ADR"));
		expect(adr).not.toContain("LABEL=");
	});

	it("round-trips a 3.0 Apple card through upgrade→downgrade preserving pref/kind", async () => {
		const apple = vcard(
			"BEGIN:VCARD",
			"VERSION:3.0",
			"N:Saxton;Josh;;;",
			"FN:Josh Saxton",
			"EMAIL;TYPE=INTERNET;TYPE=pref:saxton@example.com",
			"TEL;TYPE=CELL;TYPE=pref:+1 555 0100",
			"END:VCARD",
		);
		const out = await Effect.runPromise(
			decodeVCard(apple).pipe(
				Effect.map(upgradeToV4),
				Effect.map(downgradeToV3),
				Effect.flatMap(encodeVCard),
			),
		);
		const lines = out
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l !== "");
		expect(lines[1]).toBe("VERSION:3.0");
		expect(lines.find((l) => l.startsWith("EMAIL"))).toContain("pref");
		expect(lines.find((l) => l.startsWith("TEL"))).toContain("pref");
		// numeric PREF must not survive to 3.0 output
		expect(lines.some((l) => l.includes("PREF=1"))).toBe(false);
	});
});
