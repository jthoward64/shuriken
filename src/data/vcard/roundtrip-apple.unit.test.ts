import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { decodeVCard, encodeVCard } from "./codec.ts";

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
});
