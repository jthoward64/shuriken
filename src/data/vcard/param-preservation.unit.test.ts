import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { decodeVCard, encodeVCard } from "./codec.ts";
import { downgradeToV3 } from "./downgrade-v3.ts";
import { upgradeToV4 } from "./upgrade-v4.ts";

// ---------------------------------------------------------------------------
// Client parameters must survive every 3.0 ↔ 4.0 mapping.
//
// A property that is renamed, folded, or re-typed between versions is exactly
// where a client's own `X-` parameters are easiest to drop by accident: the
// transform builds a fresh property and forgets to carry them. Each mapped
// property here carries a uniquely tagged parameter so a regression names
// itself.
//
// Parameter *names* come back upper-cased — RFC 6350 §3.3 makes them
// case-insensitive — so assertions compare against the upper-case form.
// ---------------------------------------------------------------------------

const vcard = (...ls: Array<string>) => `${ls.join("\r\n")}\r\n`;

const lines = (out: string): Array<string> =>
	out
		.replace(/\r?\n[ \t]/gu, "")
		.split(/\r?\n/u)
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

/** Every 3.0-mapped property, each tagged with its own `X-KEEP` value. */
const TAGGED_V3 = vcard(
	"BEGIN:VCARD",
	"VERSION:3.0",
	"FN:Jane",
	"N:Doe;Jane;;;",
	"EMAIL;TYPE=INTERNET;TYPE=pref;X-KEEP=email:jane@example.com",
	"UID;X-KEEP=uid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
	"GEO;X-KEEP=geo:37.386013;-122.082932",
	"X-GENDER;X-KEEP=gender:M",
	"X-ADDRESSBOOKSERVER-KIND;X-KEEP=kind:group",
	"item1.X-ABDATE;X-KEEP=anniversary:2020-01-02",
	"item1.X-ABLABEL:_$!<Anniversary>!$_",
	"ADR;TYPE=WORK:;;1 Main St;Springfield;;;",
	"LABEL;TYPE=WORK;X-KEEP=label:1 Main St",
	"PHOTO;ENCODING=b;TYPE=JPEG;X-KEEP=photo:/9j/4AAQ",
	"X-SPOUSE;X-KEEP=spouse:Joshua",
	"END:VCARD",
);

const TAGS = [
	"email",
	"uid",
	"geo",
	"gender",
	"kind",
	"anniversary",
	"label",
	"photo",
	"spouse",
];

describe("client parameters across the 3.0 ↔ 4.0 mappings", () => {
	it("survive the upgrade to 4.0", async () => {
		const out = await upRaw(TAGGED_V3);
		expect(TAGS.filter((t) => !out.includes(`X-KEEP=${t}`))).toEqual([]);
	});

	it("survive a full 3.0 → 4.0 → 3.0 round-trip", async () => {
		const out = await downRaw(await upRaw(TAGGED_V3));
		expect(TAGS.filter((t) => !out.includes(`X-KEEP=${t}`))).toEqual([]);
	});

	it("returns a LABEL's own parameters to the LABEL, not the ADR", async () => {
		const back = lines(await downRaw(await upRaw(TAGGED_V3)));
		expect(back.find((l) => l.startsWith("LABEL"))).toContain("X-KEEP=label");
		expect(back.find((l) => l.startsWith("ADR"))).not.toContain("X-KEEP");
	});

	it("returns ANNIVERSARY's parameters to X-ABDATE, not its label", async () => {
		const back = lines(await downRaw(await upRaw(TAGGED_V3)));
		expect(back.find((l) => l.includes("X-ABDATE"))).toContain(
			"X-KEEP=anniversary",
		);
		expect(back.find((l) => l.includes("X-ABLABEL"))).not.toContain("X-KEEP");
	});
});

describe("client X- properties are not mistaken for ours", () => {
	const foreign = vcard(
		"BEGIN:VCARD",
		"VERSION:4.0",
		"FN:Jane",
		"N:Doe;Jane;;;",
		// X-AGENT is the name we park an embedded-vCard AGENT under. Unmarked, it
		// is the client's own property and must keep its name.
		"X-AGENT;X-MYFIELD=value:something of my own",
		// A bare X-ABDATE with no Anniversary label is a custom date, not one.
		"X-ABDATE;X-MYFIELD=value:2020-01-02",
		"X-WHOLLY-UNKNOWN;X-MYFIELD=value;X-OTHER=2:payload",
		"END:VCARD",
	);

	it("leaves them untouched on downgrade", async () => {
		const back = lines(await downRaw(foreign));
		expect(back).toContain("X-AGENT;X-MYFIELD=value:something of my own");
		expect(back).toContain("X-ABDATE;X-MYFIELD=value:2020-01-02");
		expect(back).toContain(
			"X-WHOLLY-UNKNOWN;X-MYFIELD=value;X-OTHER=2:payload",
		);
	});

	it("leaves them untouched on upgrade", async () => {
		const up = lines(await upRaw(foreign));
		expect(up).toContain("X-AGENT;X-MYFIELD=value:something of my own");
		expect(up).toContain("X-ABDATE;X-MYFIELD=value:2020-01-02");
		expect(up.some((l) => l.startsWith("RELATED"))).toBe(false);
		expect(up.some((l) => l.startsWith("ANNIVERSARY"))).toBe(false);
	});

	it("still restores an X-AGENT that we parked", async () => {
		const embedded = "AGENT:BEGIN:VCARD\\nVERSION:3.0\\nFN:Nested\\nEND:VCARD";
		const parked = lines(
			await upRaw(
				vcard("BEGIN:VCARD", "VERSION:3.0", "FN:Jane", embedded, "END:VCARD"),
			),
		).find((l) => l.startsWith("X-AGENT"));
		expect(parked).toContain("X-SKN-RELATION-SOURCE=AGENT");

		const back = lines(
			await downRaw(
				await upRaw(
					vcard("BEGIN:VCARD", "VERSION:3.0", "FN:Jane", embedded, "END:VCARD"),
				),
			),
		);
		// The marker is ours; it must not leak back to the client.
		expect(back).toContain(embedded);
		expect(back.some((l) => l.includes("X-SKN-"))).toBe(false);
	});
});
