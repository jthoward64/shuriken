import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { decodeVCard, encodeVCard } from "./codec.ts";
import { upgradeToV4 } from "./upgrade-v4.ts";

const vcard = (...lines: Array<string>) => `${lines.join("\r\n")}\r\n`;

// decode → upgrade → encode, returning the emitted lines (blank-trimmed)
const up = (text: string): Promise<Array<string>> =>
	Effect.runPromise(
		decodeVCard(text).pipe(
			Effect.map(upgradeToV4),
			Effect.flatMap(encodeVCard),
		),
	).then((out) =>
		out
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l !== ""),
	);

describe("upgradeToV4", () => {
	it("converts a 3.0 TYPE=pref token to numeric PREF=1", async () => {
		const lines = await up(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:Jane",
				"EMAIL;TYPE=INTERNET;TYPE=pref:jane@example.com",
				"END:VCARD",
			),
		);
		const email = lines.find((l) => l.startsWith("EMAIL"));
		expect(email).toContain("PREF=1");
		expect(email).toContain("TYPE=INTERNET");
		expect(email?.toLowerCase()).not.toContain("pref:");
		expect(email).not.toContain("TYPE=pref");
	});

	it("forces VERSION to 4.0 and positions it first", async () => {
		const lines = await up(
			vcard("BEGIN:VCARD", "VERSION:3.0", "FN:Jane", "END:VCARD"),
		);
		expect(lines).toContain("VERSION:4.0");
		expect(lines).not.toContain("VERSION:3.0");
		expect(lines[0]).toBe("BEGIN:VCARD");
		expect(lines[1]).toBe("VERSION:4.0");
	});

	it("is idempotent on an already-4.0 card with PREF=1", async () => {
		const input = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Jane",
			"EMAIL;TYPE=work;PREF=1:jane@work.example",
			"END:VCARD",
		);
		const once = await up(input);
		expect(once).toContain("VERSION:4.0");
		const email = once.find((l) => l.startsWith("EMAIL"));
		expect(email).toContain("PREF=1");
		// exactly one PREF, not duplicated
		expect(email?.match(/PREF=/g)?.length).toBe(1);
	});

	it("leaves item-grouped and X- extension properties untouched", async () => {
		const lines = await up(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:Josh",
				"item1.EMAIL;TYPE=INTERNET:josh@example.com",
				"item1.X-ABLABEL:_$!<Other>!$_",
				"X-SOCIALPROFILE;TYPE=NEXTCLOUD:https://nc.example/u/j",
				"END:VCARD",
			),
		);
		expect(lines).toContain("item1.X-ABLABEL:_$!<Other>!$_");
		expect(lines).toContain(
			"X-SOCIALPROFILE;TYPE=NEXTCLOUD:https://nc.example/u/j",
		);
	});

	it("converts structured GEO to a geo: URI", async () => {
		const lines = await up(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:Jane",
				"GEO:37.386;-122.083",
				"END:VCARD",
			),
		);
		expect(lines).toContain("GEO:geo:37.386,-122.083");
	});

	it("upgrades a bare-UUID UID to a urn:uuid URI", async () => {
		const lines = await up(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:Jane",
				"UID:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
				"END:VCARD",
			),
		);
		expect(lines).toContain(
			"UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
		);
	});

	it("leaves a multi-field GEO (with altitude) untouched rather than losing data", async () => {
		const lines = await up(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:Jane",
				"GEO:37.386;-122.083;5",
				"END:VCARD",
			),
		);
		// not a clean lat;lon → not converted, and no component dropped
		expect(lines).toContain("GEO:37.386;-122.083;5");
	});

	it("preserves deprecated and obsolete properties verbatim (no data loss)", async () => {
		const lines = await up(
			vcard(
				"BEGIN:VCARD",
				"VERSION:3.0",
				"FN:Jane",
				"MAILER:Mutt",
				"NAME:Jane's Card",
				"PROFILE:VCARD",
				"CLASS:PUBLIC",
				"SORT-STRING:Doe",
				"LABEL;TYPE=home:123 Main St",
				"END:VCARD",
			),
		);
		expect(lines).toContain("MAILER:Mutt");
		expect(lines).toContain("NAME:Jane's Card");
		expect(lines).toContain("PROFILE:VCARD");
		expect(lines).toContain("CLASS:PUBLIC");
		expect(lines).toContain("SORT-STRING:Doe");
		expect(lines.some((l) => l.startsWith("LABEL"))).toBe(true);
	});
});
