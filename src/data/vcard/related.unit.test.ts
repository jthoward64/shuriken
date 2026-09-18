import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { decodeVCard, encodeVCard } from "./codec.ts";
import { downgradeToV3 } from "./downgrade-v3.ts";
import { upgradeToV4 } from "./upgrade-v4.ts";

const LINE_BREAK = /\r?\n/u;
const ITEM_GROUP_PREFIX = /^item\d+\./u;
const EMPTY_LINE = /^$/u;

const vcard = (...ls: Array<string>) => `${ls.join("\r\n")}\r\n`;

/** Unfold first — a preserved label easily pushes RELATED past the fold width. */
const lines = (out: string): Array<string> =>
	out
		.replace(/\r?\n[ \t]/gu, "")
		.split(LINE_BREAK)
		.map((l) => l.trim())
		.filter((l) => l !== "");

const upRaw = (text: string): Promise<string> =>
	Effect.runPromise(
		decodeVCard(text).pipe(
			Effect.map(upgradeToV4),
			Effect.flatMap(encodeVCard),
		),
	);

const downRaw = (text: string): Promise<string> =>
	Effect.runPromise(
		decodeVCard(text).pipe(
			Effect.map(downgradeToV3),
			Effect.flatMap(encodeVCard),
		),
	);

const up = (text: string): Promise<Array<string>> => upRaw(text).then(lines);
const down = (text: string): Promise<Array<string>> =>
	downRaw(text).then(lines);

const relatedOf = (ls: Array<string>): string =>
	ls.find((l) => l.startsWith("RELATED")) ?? "";

const abOf = (ls: Array<string>): Array<string> =>
	ls.filter((l) => ITEM_GROUP_PREFIX.test(l));

/** An Apple 3.0 card carrying one related name with the given label. */
const appleCard = (label: string, name = "Joshua Tag Howard") =>
	vcard(
		"BEGIN:VCARD",
		"VERSION:3.0",
		"FN:Meghan",
		`item2.X-ABRELATEDNAMES;TYPE=pref:${name}`,
		`item2.X-ABLABEL:${label}`,
		"END:VCARD",
	);

/** 3.0 → 4.0 → 3.0, returning the grouped Apple lines that came back. */
const roundTrip = async (text: string): Promise<Array<string>> =>
	abOf(lines(await downRaw(await upRaw(text))));

describe("X-ABRELATEDNAMES ↔ RELATED", () => {
	it("maps a built-in Apple relation onto its registered token alone", async () => {
		const related = relatedOf(await up(appleCard("_$!<Spouse>!$_")));
		expect(related).toContain("TYPE=spouse");
		expect(related).toContain("VALUE=text");
		expect(related).toContain("PREF=1");
		expect(related).toContain(":Joshua Tag Howard");
		// The token reproduces the label, so no preservation parameter is needed.
		expect(related).not.toContain("X-SKN-RELATION-LABEL");
	});

	it("preserves the wording when the token would coarsen it", async () => {
		const related = relatedOf(await up(appleCard("_$!<Mother>!$_")));
		expect(related).toContain("TYPE=parent");
		expect(related).toContain("X-SKN-RELATION-LABEL=_$!<Mother>!$_");
	});

	it("keeps a custom relation verbatim under the generic token", async () => {
		const related = relatedOf(await up(appleCard("Golf buddy")));
		expect(related).toContain("TYPE=contact");
		expect(related).toContain("X-SKN-RELATION-LABEL=Golf buddy");
	});

	it("drops the sibling label once the relation is on the RELATED", async () => {
		const ls = await up(appleCard("_$!<Spouse>!$_"));
		expect(ls.some((l) => l.includes("X-ABRELATEDNAMES"))).toBe(false);
		expect(ls.some((l) => l.includes("X-ABLABEL"))).toBe(false);
	});

	it("leaves a group's label alone when something else in it still needs it", async () => {
		const ls = await up(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:Meghan",
				"item1.EMAIL:jane@example.com",
				"item1.X-ABLABEL:_$!<Other>!$_",
				"item2.X-ABRELATEDNAMES:Joshua",
				"item2.X-ABLABEL:_$!<Spouse>!$_",
				"END:VCARD",
			),
		);
		expect(ls).toContain("item1.X-ABLABEL:_$!<Other>!$_");
		expect(ls.some((l) => l.startsWith("item2."))).toBe(false);
	});

	for (const label of [
		"_$!<Spouse>!$_",
		"_$!<Mother>!$_",
		"_$!<Father>!$_",
		"_$!<Brother>!$_",
		"_$!<Assistant>!$_",
		"_$!<Manager>!$_",
		"_$!<Other>!$_",
		"Golf buddy",
	]) {
		it(`round-trips ${label} back to the exact same pair`, async () => {
			const back = await roundTrip(appleCard(label));
			expect(back).toContain(
				"item1.X-ABRELATEDNAMES;TYPE=pref:Joshua Tag Howard",
			);
			expect(back).toContain(`item1.X-ABLABEL:${label}`);
		});
	}

	it("gives a 4.0-only relation type a custom label a 3.0 client can show", async () => {
		const back = abOf(
			await down(
				vcard(
					"BEGIN:VCARD",
					"VERSION:4.0",
					"FN:Meghan",
					"RELATED;VALUE=text;TYPE=muse:Erato",
					"END:VCARD",
				),
			),
		);
		expect(back).toContain("item1.X-ABRELATEDNAMES:Erato");
		expect(back).toContain("item1.X-ABLABEL:Muse");
	});

	it("shows a linked contact's name rather than its UID on downgrade", async () => {
		const back = abOf(
			await down(
				vcard(
					"BEGIN:VCARD",
					"VERSION:4.0",
					"FN:Meghan",
					"RELATED;TYPE=spouse;X-SKN-RELATION-NAME=Joshua Tag Howard:urn:uuid:019efd61-eb6a-7964-a228-9bf73a3b9cca",
					"END:VCARD",
				),
			),
		);
		expect(back).toContain("item1.X-ABRELATEDNAMES:Joshua Tag Howard");
		expect(back).toContain("item1.X-ABLABEL:_$!<Spouse>!$_");
	});

	it("uses a mailto: address as the display name when nothing better exists", async () => {
		const back = abOf(
			await down(
				vcard(
					"BEGIN:VCARD",
					"VERSION:4.0",
					"FN:Meghan",
					"RELATED;TYPE=friend:mailto:jane@example.com",
					"END:VCARD",
				),
			),
		);
		expect(back).toContain("item1.X-ABRELATEDNAMES:jane@example.com");
	});

	it("folds the single-property forms and remembers which one it was", async () => {
		const ls = await up(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:Meghan",
				"X-SPOUSE:Joshua",
				"X-MANAGER:Dana",
				"X-ASSISTANT:Sam",
				"AGENT:Jane",
				"END:VCARD",
			),
		);
		const related = ls.filter((l) => l.startsWith("RELATED"));
		expect(related).toHaveLength(4);
		// spouse's token reproduces its wording; manager/assistant map to coarser
		// tokens and so carry the wording alongside.
		expect(related[0]).toBe(
			"RELATED;VALUE=text;TYPE=spouse;X-SKN-RELATION-SOURCE=X-SPOUSE:Joshua",
		);
		expect(related[1]).toContain("TYPE=co-worker");
		expect(related[1]).toContain("X-SKN-RELATION-LABEL=Manager");
		expect(related[2]).toContain("X-SKN-RELATION-LABEL=Assistant");
		expect(related[3]).toContain("X-SKN-RELATION-SOURCE=AGENT");
		expect(related[3]).not.toContain("X-SKN-RELATION-LABEL");
	});

	for (const [line, source] of [
		["X-SPOUSE:Joshua", "X-SPOUSE:Joshua"],
		["X-MANAGER:Dana", "X-MANAGER:Dana"],
		["X-ASSISTANT:Sam", "X-ASSISTANT:Sam"],
		["AGENT:Jane", "AGENT:Jane"],
		[
			"AGENT;VALUE=uri:http://example.com/a.vcf",
			"AGENT;VALUE=uri:http://example.com/a.vcf",
		],
	] as const) {
		it(`restores ${line.split(":")[0]} to its own property on downgrade`, async () => {
			const back = await down(
				(
					await upRaw(
						vcard("BEGIN:VCARD", "VERSION:3.0", "FN:Meghan", line, "END:VCARD"),
					)
				).replace(EMPTY_LINE, ""),
			);
			expect(back).toContain(source);
			expect(back.some((l) => l.startsWith("item"))).toBe(false);
		});
	}

	it("parks an AGENT holding a nested vCard under X-AGENT and hands it back", async () => {
		const embedded = "AGENT:BEGIN:VCARD\\nVERSION:3.0\\nFN:Nested\\nEND:VCARD";
		const original = vcard(
			"BEGIN:VCARD",
			"VERSION:3.0",
			"FN:Meghan",
			embedded,
			"END:VCARD",
		);
		const asV4 = await up(original);
		// RELATED holds a URI or a name, never a whole card — so it is not folded.
		expect(asV4.some((l) => l.startsWith("RELATED"))).toBe(false);
		// Marked as ours, so a client's own X-AGENT is never renamed to AGENT.
		const parked = asV4.find((l) => l.startsWith("X-AGENT"));
		expect(parked).toContain("X-SKN-RELATION-SOURCE=AGENT");
		expect(parked).toContain(embedded.slice("AGENT:".length));
		expect(lines(await downRaw(await upRaw(original)))).toContain(embedded);
	});

	it("falls back to the Apple pair when an X- source cannot hold a link", async () => {
		// X-SPOUSE is name-valued, so a contact reference has to downgrade as a
		// grouped related name, which knows how to carry a display name.
		const back = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Meghan",
				"RELATED;VALUE=uri;TYPE=spouse;X-SKN-RELATION-SOURCE=X-SPOUSE;X-SKN-RELATION-NAME=Joshua:urn:uuid:019efd61-eb6a-7964-a228-9bf73a3b9cca",
				"END:VCARD",
			),
		);
		expect(back.some((l) => l.startsWith("X-SPOUSE"))).toBe(false);
		expect(back).toContain("item1.X-ABRELATEDNAMES:Joshua");
		expect(back).toContain("item1.X-ABLABEL:_$!<Spouse>!$_");
	});

	it("leaves a bare UID reference as RELATED rather than writing a UID as a name", async () => {
		const ls = await down(
			vcard(
				"BEGIN:VCARD",
				"VERSION:4.0",
				"FN:Meghan",
				"RELATED;TYPE=spouse:urn:uuid:019efd61-eb6a-7964-a228-9bf73a3b9cca",
				"END:VCARD",
			),
		);
		expect(abOf(ls)).toHaveLength(0);
		expect(relatedOf(ls)).toContain("urn:uuid:019efd61");
	});
});
