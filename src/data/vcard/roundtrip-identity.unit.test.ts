import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import type { IrDocument } from "#src/data/ir.ts";
import { decodeVCard, encodeVCard } from "./codec.ts";
import { downgradeToV3 } from "./downgrade-v3.ts";
import { upgradeToV4 } from "./upgrade-v4.ts";

// ---------------------------------------------------------------------------
// Exhaustive round-trip identity: upgrade and downgrade are mutual inverses.
//
//   upgrade(downgrade(x)) ≡ x   for canonical 4.0 x
//   downgrade(upgrade(y)) ≡ y   for 3.0 y
//
// Measured at the WIRE level (encode∘transform∘decode) — the real client path,
// which re-types values between hops. Equivalence is SEMANTIC: independent of
// line order, parameter order, TYPE-token order, and arbitrary itemN group
// numbering (compared by group content-signature).
//
// Two 3.0 limitations are provably irreversible and are asserted separately as
// documented exceptions, not identities: PREF numeric ranking and mandatory N.
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

// --- semantic-equivalence normalizer --------------------------------------

const toLines = (s: string): Array<string> =>
	s
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l !== "" && l !== "BEGIN:VCARD" && l !== "END:VCARD");

// Split on `sep`, honoring RFC 6350 double-quoted param values.
const splitUnquoted = (s: string, sep: string): Array<string> => {
	const out: Array<string> = [];
	let cur = "";
	let quoted = false;
	for (const c of s) {
		if (c === '"') {
			quoted = !quoted;
			cur += c;
		} else if (c === sep && !quoted) {
			out.push(cur);
			cur = "";
		} else {
			cur += c;
		}
	}
	out.push(cur);
	return out;
};

interface ParsedLine {
	readonly group: string;
	readonly body: string;
}

// Canonicalize a line's parameters: merge ALL TYPE tokens (across repeated and
// comma-joined params — semantically equivalent per RFC 6350 §5.6) into one
// sorted set, uppercase param names, and sort the resulting params.
const canonParams = (segs: ReadonlyArray<string>): string => {
	const typeTokens = new Set<string>();
	const other: Array<string> = [];
	for (const seg of segs) {
		const eq = seg.indexOf("=");
		const name = (eq === -1 ? seg : seg.slice(0, eq)).toUpperCase();
		const value = eq === -1 ? "" : seg.slice(eq + 1);
		if (name === "TYPE") {
			for (const t of splitUnquoted(value, ",")) {
				const tok = t.trim().toLowerCase();
				if (tok !== "") {
					typeTokens.add(tok);
				}
			}
		} else {
			other.push(eq === -1 ? name : `${name}=${value}`);
		}
	}
	const params: Array<string> = [];
	if (typeTokens.size > 0) {
		params.push(`TYPE=${[...typeTokens].sort().join(",")}`);
	}
	params.push(...other);
	return params.sort().join(";");
};

const parseLine = (line: string): ParsedLine => {
	const colonParts = splitUnquoted(line, ":");
	const head = colonParts[0] ?? "";
	const value = colonParts.slice(1).join(":");
	const headSegs = splitUnquoted(head, ";");
	const nameFull = headSegs[0] ?? "";
	const dot = nameFull.indexOf(".");
	const group = dot === -1 ? "" : nameFull.slice(0, dot).toLowerCase();
	const name = (dot === -1 ? nameFull : nameFull.slice(dot + 1)).toUpperCase();
	const params = canonParams(headSegs.slice(1));
	const body = `${name}${params !== "" ? `;${params}` : ""}:${value}`;
	return { group, body };
};

// A representation invariant to line/param/token order and group numbering.
const normalize = (text: string): Array<string> => {
	const parsed = toLines(text).map(parseLine);
	// signature per group = sorted member bodies (numbering-independent)
	const groupBodies = new Map<string, Array<string>>();
	for (const { group, body } of parsed) {
		if (group !== "") {
			const arr = groupBodies.get(group) ?? [];
			arr.push(body);
			groupBodies.set(group, arr);
		}
	}
	const sig = new Map<string, string>();
	for (const [g, bodies] of groupBodies) {
		sig.set(g, [...bodies].sort().join("¦"));
	}
	return parsed
		.map(({ group, body }) =>
			group === "" ? `·${body}` : `G[${sig.get(group)}]·${body}`,
		)
		.sort();
};

const expectEquivalent = (a: string, b: string): void => {
	expect(normalize(a)).toEqual(normalize(b));
};

// --- fixtures --------------------------------------------------------------

const SIMPLE_V4 = vcard(
	"BEGIN:VCARD",
	"VERSION:4.0",
	"FN:Jane Doe",
	"N:Doe;Jane;;;",
	"UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
	"EMAIL;PREF=1:jane@e.com",
	"END:VCARD",
);

// A dense 4.0 card touching every property the transforms remap.
const KITCHEN_SINK_V4 = vcard(
	"BEGIN:VCARD",
	"VERSION:4.0",
	"FN:Dr. Jane Q. Doe Jr.",
	"N:Doe;Jane;Q;Dr;Jr",
	"NICKNAME:JJ,Janey",
	"UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
	"KIND:individual",
	"EMAIL;TYPE=work;PREF=1:jane@work.com",
	"EMAIL;TYPE=home:jane@home.com",
	"TEL;TYPE=cell;PREF=1:+15550100",
	"TEL;TYPE=voice,work:+15550200",
	"ADR;TYPE=home;LABEL=123 Main St:;;123 Main St;City;ST;12345;USA",
	"URL:https://jane.example",
	"IMPP:xmpp:jane@chat.example",
	"BDAY:1985-04-12",
	"ANNIVERSARY:2010-06-15",
	"GENDER:F;femme",
	"ORG:Example Inc.;Engineering",
	"TITLE:Principal Engineer",
	"NOTE:Multi\\nline\\; note\\, with escapes \\\\",
	"CATEGORIES:FRIEND,VIP",
	"GEO:geo:38.04,-84.5",
	"TZ:-05:00",
	"PHOTO:https://example.com/p.jpg",
	"item1.EMAIL;TYPE=other:jane@alt.com",
	"item1.X-ABLABEL:_$!<Custom>!$_",
	"X-SOCIALPROFILE;TYPE=twitter:https://twitter.com/jane",
	"X-CUSTOM-FIELD:whatever",
	"END:VCARD",
);

const GROUP_CARD_V4 = vcard(
	"BEGIN:VCARD",
	"VERSION:4.0",
	"FN:My Group",
	"N:My Group;;;;",
	"UID:urn:uuid:99999999-0bc3-424c-9c26-36c3e1eff6b1",
	"KIND:group",
	"MEMBER:urn:uuid:11111111-1111-1111-1111-111111111111",
	"MEMBER:urn:uuid:22222222-2222-2222-2222-222222222222",
	"END:VCARD",
);

// Adversarial 4.0: multiple groups + an anniversary group (forces renumbering),
// unicode, quoted param values, and escaped structured fields.
const ADVERSARIAL_V4 = vcard(
	"BEGIN:VCARD",
	"VERSION:4.0",
	"FN:Jörg 🐙 O'Brien",
	"N:O'Brien;Jörg;;;",
	"UID:urn:uuid:abcdef01-2345-6789-abcd-ef0123456789",
	"EMAIL;TYPE=work,home;PREF=1:jorg@e.com",
	"ADR;TYPE=work;LABEL=Suite 5\\, Building A:;;1 Plaza;Metropolis;;;",
	"ANNIVERSARY:--0615",
	"GENDER:O;non-binary",
	"item1.URL:https://a.example",
	"item1.X-ABLABEL:_$!<HomePage>!$_",
	"item2.TEL:+15550999",
	"item2.X-ABLABEL:_$!<Fax>!$_",
	"END:VCARD",
);

// 3.0 fixtures — native Apple/3.0 forms (what a real 3.0 client PUTs).
const KITCHEN_SINK_V3 = vcard(
	"BEGIN:VCARD",
	"VERSION:3.0",
	"FN:Dr. Jane Q. Doe Jr.",
	"N:Doe;Jane;Q;Dr;Jr",
	"NICKNAME:JJ,Janey",
	"UID:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
	"X-ADDRESSBOOKSERVER-KIND:individual",
	"EMAIL;TYPE=WORK;TYPE=pref:jane@work.com",
	"EMAIL;TYPE=HOME:jane@home.com",
	"TEL;TYPE=CELL;TYPE=pref:+15550100",
	"X-GENDER:F;femme",
	"item1.X-ABDATE:2010-06-15",
	"item1.X-ABLABEL:_$!<Anniversary>!$_",
	"GEO:38.04;-84.5",
	"END:VCARD",
);

// --- identity tests --------------------------------------------------------

describe("upgrade(downgrade(x)) ≡ x for canonical 4.0", () => {
	const cases: ReadonlyArray<readonly [string, string]> = [
		["simple", SIMPLE_V4],
		["kitchen-sink", KITCHEN_SINK_V4],
		["group card (KIND/MEMBER)", GROUP_CARD_V4],
		["adversarial (groups/unicode/quoting)", ADVERSARIAL_V4],
	];
	for (const [name, fixture] of cases) {
		it(name, async () => {
			// x is the codec+transform-canonical 4.0 form; assert down→up is a fixpoint on it.
			const x = await up(fixture);
			const roundTripped = await up(await down(x));
			expectEquivalent(roundTripped, x);
		});
	}
});

describe("downgrade(upgrade(y)) ≡ y for 3.0", () => {
	it("kitchen-sink 3.0 (native Apple X- forms)", async () => {
		// y is the canonical 3.0 form; assert up→down is a fixpoint on it.
		const y = await down(await up(KITCHEN_SINK_V3));
		const roundTripped = await down(await up(y));
		expectEquivalent(roundTripped, y);
	});
});

describe("documented irreversible 3.0 limitations", () => {
	it("PREF numeric ranking collapses to PREF=1 (3.0 has no ranking)", async () => {
		const x = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:X",
			"N:X;;;;",
			"EMAIL;PREF=50:x@e.com",
			"END:VCARD",
		);
		const out = await up(await down(x));
		const email = toLines(out).find((l) => l.startsWith("EMAIL"));
		expect(email).toContain("PREF=1");
		expect(email).not.toContain("PREF=50");
	});

	it("a missing N is synthesized from FN on downgrade (3.0 requires N)", async () => {
		const x = vcard("BEGIN:VCARD", "VERSION:4.0", "FN:Jane Doe", "END:VCARD");
		const out = await up(await down(x));
		expect(toLines(out)).toContain("N:Jane Doe;;;;");
	});
});
