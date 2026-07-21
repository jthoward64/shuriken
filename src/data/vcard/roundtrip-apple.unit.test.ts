import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { decodeVCard, encodeVCard } from "./codec.ts";
import { upgradeToV4 } from "./upgrade-v4.ts";

// ---------------------------------------------------------------------------
// Lossless round-trip of the Apple/Google vCard 3.0 conventions that clients
// rely on (see the "sad story of vCard interoperability"): itemN grouping,
// repeated TYPE params, X-ABLabel (wrapped built-ins and custom), and X-
// vendor extensions like X-SOCIALPROFILE with custom TYPE tokens. The contact-
// cleanup write-back edits this same IR, so preserving it here guarantees a fix
// never mangles unrelated custom properties.
// ---------------------------------------------------------------------------

const APPLE_CARD = [
	"BEGIN:VCARD",
	"VERSION:3.0",
	"PRODID:-//Apple Inc.//iPhone OS 26.5//EN",
	"N:Saxton;Josh;;;",
	"FN:Josh Saxton",
	"item1.EMAIL;TYPE=INTERNET;TYPE=pref:saxton@yahoo.com",
	"item1.X-ABLABEL:_$!<Other>!$_",
	"TEL;TYPE=CELL;TYPE=VOICE;TYPE=pref:+1 (859) 420-5324",
	"item2.URL;TYPE=pref:https://joebloggs.com",
	"item2.X-ABLABEL:VALUE",
	"X-SOCIALPROFILE;TYPE=NEXTCLOUD:https://nc.example/u/j",
	"END:VCARD",
	"",
].join("\r\n");

const lineSet = (s: string): ReadonlyArray<string> =>
	s
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l !== "")
		.sort();

describe("vCard Apple 3.0 round-trip", () => {
	it("decode → encode preserves every line", async () => {
		const out = await Effect.runPromise(
			Effect.flatMap(decodeVCard(APPLE_CARD), encodeVCard),
		);
		expect(lineSet(out)).toEqual(lineSet(APPLE_CARD));
	});

	// The codec is version-transparent (above); version normalization happens at
	// ingest via upgradeToV4, which converges the card on canonical 4.0 while
	// still preserving item-grouped and X- extension lines verbatim.
	it("ingest upgrade converts to 4.0 + PREF, preserving item/X- lines", async () => {
		const out = await Effect.runPromise(
			decodeVCard(APPLE_CARD).pipe(
				Effect.map(upgradeToV4),
				Effect.flatMap(encodeVCard),
			),
		);
		const lines = lineSet(out);
		expect(lines).toContain("VERSION:4.0");
		expect(lines).not.toContain("VERSION:3.0");
		expect(lines).toContain("item1.X-ABLABEL:_$!<Other>!$_");
		expect(lines).toContain("item2.X-ABLABEL:VALUE");
		expect(lines).toContain(
			"X-SOCIALPROFILE;TYPE=NEXTCLOUD:https://nc.example/u/j",
		);
		// TYPE=pref markers are upgraded to numeric PREF=1
		expect(out).toContain("PREF=1");
		expect(out).not.toContain("TYPE=pref");
	});
});
