import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import type { IrDocument } from "#src/data/ir.ts";
import { decodeVCard, encodeVCard } from "./codec.ts";
import { downgradeToV3 } from "./downgrade-v3.ts";
import { baseName } from "./prop.ts";
import { upgradeToV4 } from "./upgrade-v4.ts";

// ---------------------------------------------------------------------------
// Adversarial + property-based round-trip safety for the vCard version
// transforms. The goal is confidence that ingest (upgradeToV4) never loses or
// corrupts client data, that it is stable/idempotent, and that badly-behaved
// client input is handled without crashing or dropping information.
// ---------------------------------------------------------------------------

const vcard = (...lines: Array<string>) => `${lines.join("\r\n")}\r\n`;

const decode = (t: string): Promise<IrDocument> =>
	Effect.runPromise(decodeVCard(t));
const encode = (d: IrDocument): Promise<string> =>
	Effect.runPromise(encodeVCard(d));

const up = async (t: string): Promise<string> =>
	encode(upgradeToV4(await decode(t)));
const down = async (t: string): Promise<string> =>
	encode(downgradeToV3(await decode(t)));

const toLines = (s: string): Array<string> =>
	s
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l !== "");

// Multiset of property base names (group-insensitive), excluding VERSION which
// upgrade legitimately dedups/normalizes.
const baseNames = async (t: string): Promise<Array<string>> =>
	(await decode(t)).root.properties
		.map((p) => baseName(p.name))
		.filter((n) => n !== "VERSION")
		.sort();

// A dense card exercising most property shapes at once.
const DENSE = vcard(
	"BEGIN:VCARD",
	"VERSION:3.0",
	"FN:Josh Saxton",
	"N:Saxton;Josh;Q;Dr;Jr",
	"NICKNAME:JJ,Joshie",
	"item1.EMAIL;TYPE=INTERNET;TYPE=pref:josh@example.com",
	"item1.X-ABLABEL:_$!<Work>!$_",
	"TEL;TYPE=CELL;TYPE=VOICE;TYPE=pref:+1 (555) 010-0100",
	"ADR;TYPE=home:;;123 Main St;Lexington;KY;40502;USA",
	"GEO:38.0406;-84.5037",
	"UID:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
	"BDAY:1985-04-12",
	"NOTE:Line one\\nLine two\\; and\\, punctuation \\\\ backslash",
	"CATEGORIES:FRIEND,VIP",
	"X-SOCIALPROFILE;TYPE=NEXTCLOUD:https://nc.example/u/j",
	"MAILER:Mutt",
	"END:VCARD",
);

describe("upgradeToV4 — idempotency & losslessness", () => {
	it("is a stable fixpoint: up(up(x)) === up(x)", async () => {
		const once = await up(DENSE);
		const twice = await up(once);
		expect(twice).toBe(once);
	});

	it("is stable across a full wire round-trip (decode→up→encode twice)", async () => {
		const once = await up(DENSE);
		// feed the emitted 4.0 text back through the whole pipeline
		const again = await up(once);
		expect(toLines(again)).toEqual(toLines(once));
	});

	it("preserves every non-VERSION property (no property vanishes)", async () => {
		const before = await baseNames(DENSE);
		const after = await baseNames(await up(DENSE));
		expect(after).toEqual(before);
	});

	it("preserves escaped/special characters in values byte-exact", async () => {
		const upped = await up(DENSE);
		const note = (await decode(upped)).root.properties.find(
			(p) => baseName(p.name) === "NOTE",
		);
		// value survives decode→up→encode→decode unchanged
		expect(note?.value.type === "TEXT" && note.value.value).toBe(
			"Line one\nLine two; and, punctuation \\ backslash",
		);
	});
});

describe("upgradeToV4 — adversarial preference handling", () => {
	const emailLine = async (card: string): Promise<string> =>
		toLines(await up(card)).find((l) => l.includes("EMAIL")) ?? "";

	it("upgrades mixed-case and repeated TYPE=pref forms", async () => {
		for (const pref of ["TYPE=PREF", "TYPE=Pref", "TYPE=pReF"]) {
			const line = await emailLine(
				vcard(
					"BEGIN:VCARD",
					"VERSION:3.0",
					"FN:X",
					`EMAIL;TYPE=WORK;${pref}:x@e.com`,
					"END:VCARD",
				),
			);
			expect(line).toContain("PREF=1");
			expect(line.toUpperCase()).not.toContain("TYPE=PREF");
			expect(line).toContain("TYPE=WORK");
		}
	});

	it("handles a pref token comma-joined inside a single TYPE param", async () => {
		const line = await emailLine(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:X",
				"EMAIL;TYPE=work,pref,home:x@e.com",
				"END:VCARD",
			),
		);
		expect(line).toContain("PREF=1");
		expect(line).toContain("work");
		expect(line).toContain("home");
		expect(line.toLowerCase()).not.toContain(",pref");
	});

	it("does not duplicate PREF when both PREF and TYPE=pref are present", async () => {
		const line = await emailLine(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:X",
				"EMAIL;TYPE=pref;PREF=2:x@e.com",
				"END:VCARD",
			),
		);
		expect(line.match(/PREF=/g)?.length).toBe(1);
		// an explicit numeric PREF is kept, not clobbered to 1
		expect(line).toContain("PREF=2");
	});

	it("preserves a numeric PREF ranking on already-4.0 input", async () => {
		const line = await emailLine(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:X",
				"EMAIL;PREF=50:x@e.com",
				"END:VCARD",
			),
		);
		expect(line).toContain("PREF=50");
	});

	it("upgrades a group-scoped pref while preserving the group prefix", async () => {
		const line = await emailLine(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:X",
				"item2.EMAIL;TYPE=pref:x@e.com",
				"END:VCARD",
			),
		);
		expect(line.startsWith("item2.EMAIL")).toBe(true);
		expect(line).toContain("PREF=1");
	});

	it("upgrades lowercase property and parameter names (codec normalizes case)", async () => {
		const line = await emailLine(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:X",
				"email;type=pref:x@e.com",
				"END:VCARD",
			),
		);
		expect(line).toContain("PREF=1");
	});
});

describe("upgradeToV4 — malformed / hostile input", () => {
	it("collapses multiple VERSION lines to a single 4.0", async () => {
		const lines = toLines(
			await up(
				vcard("BEGIN:VCARD", "VERSION:3.0", "VERSION:2.1", "FN:X", "END:VCARD"),
			),
		);
		expect(lines.filter((l) => l.startsWith("VERSION")).length).toBe(1);
		expect(lines).toContain("VERSION:4.0");
	});

	it("injects VERSION:4.0 when none is present", async () => {
		const lines = toLines(await up(vcard("BEGIN:VCARD", "FN:X", "END:VCARD")));
		expect(lines[1]).toBe("VERSION:4.0");
	});

	it("does not crash on an empty card (BEGIN/END only)", async () => {
		const lines = toLines(await up(vcard("BEGIN:VCARD", "END:VCARD")));
		expect(lines).toContain("VERSION:4.0");
	});

	it("leaves an already-canonical geo: URI and urn:uuid UID untouched (idempotent)", async () => {
		const lines = toLines(
			await up(
				vcard(
					"BEGIN:VCARD",
					"VERSION:4.0",
					"FN:X",
					"GEO:geo:1,2",
					"UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
					"END:VCARD",
				),
			),
		);
		expect(lines).toContain("GEO:geo:1,2");
		expect(lines).toContain(
			"UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
		);
	});

	it("leaves a non-UUID UID (e.g. mailto:) untouched", async () => {
		const lines = toLines(
			await up(
				vcard(
					"BEGIN:VCARD",
					"VERSION:3.0",
					"FN:X",
					"UID:mailto:x@e.com",
					"END:VCARD",
				),
			),
		);
		expect(lines).toContain("UID:mailto:x@e.com");
	});

	it("preserves unicode/emoji content", async () => {
		const lines = toLines(
			await up(
				vcard("BEGIN:VCARD", "VERSION:3.0", "FN:Jörg 🐙 日本", "END:VCARD"),
			),
		);
		expect(lines).toContain("FN:Jörg 🐙 日本");
	});
});

describe("vCard 2.1 ingest (upgrade to canonical 4.0)", () => {
	it("normalizes 2.1 bare params + PREF and forces VERSION 4.0", async () => {
		const lines = toLines(
			await up(
				vcard(
					"BEGIN:VCARD",
					"VERSION:2.1",
					"FN:Old Client",
					"N:Doe;Jane;;;",
					"TEL;WORK;VOICE;PREF:+1-555-0100",
					"EMAIL;INTERNET:jane@e.com",
					"END:VCARD",
				),
			),
		);
		expect(lines).toContain("VERSION:4.0");
		expect(lines.some((l) => l.startsWith("VERSION:2.1"))).toBe(false);
		const tel = lines.find((l) => l.startsWith("TEL"));
		expect(tel).toContain("PREF=1");
		expect(tel).toContain("TYPE=WORK,VOICE");
		expect(lines.find((l) => l.startsWith("EMAIL"))).toContain("TYPE=INTERNET");
	});
});

describe("transform guards — non-vcard documents pass through untouched", () => {
	const ical: IrDocument = {
		kind: "icalendar",
		root: { name: "VCALENDAR", properties: [], components: [] },
	};

	it("upgradeToV4 returns a non-vcard document by reference", () => {
		expect(upgradeToV4(ical)).toBe(ical);
	});

	it("downgradeToV3 returns a non-vcard document by reference", () => {
		expect(downgradeToV3(ical)).toBe(ical);
	});
});

describe("3.0 → upgrade → downgrade round-trip symmetry", () => {
	it("restores the 3.0 shape for VERSION / PREF / GEO / UID", async () => {
		const card = vcard(
			"BEGIN:VCARD",
			"VERSION:3.0",
			"FN:Jane Doe",
			"N:Doe;Jane;;;",
			"EMAIL;TYPE=INTERNET;TYPE=pref:jane@e.com",
			"GEO:38.04;-84.5",
			"UID:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
			"END:VCARD",
		);
		const out = await encode(downgradeToV3(upgradeToV4(await decode(card))));
		const lines = toLines(out);
		expect(lines[1]).toBe("VERSION:3.0");
		expect(lines.find((l) => l.includes("EMAIL"))).toContain("pref");
		expect(lines.find((l) => l.includes("EMAIL"))).not.toContain("PREF=1");
		expect(lines).toContain("GEO:38.04;-84.5");
		expect(lines).toContain("UID:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1");
	});

	it("keeps preference through a full 3.0→4.0→3.0→4.0 excursion", async () => {
		const card = vcard(
			"BEGIN:VCARD",
			"VERSION:3.0",
			"FN:X",
			"EMAIL;TYPE=pref:x@e.com",
			"END:VCARD",
		);
		const v4a = await up(card);
		const v3 = await down(v4a);
		const v4b = await up(v3);
		// preference survives the excursion and lands back on the canonical PREF
		expect(toLines(v4b).find((l) => l.includes("EMAIL"))).toContain("PREF=1");
	});
});
