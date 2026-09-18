import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { decodeVCard, encodeVCard } from "./codec.ts";
import { downgradeToV3 } from "./downgrade-v3.ts";
import { upgradeToV4 } from "./upgrade-v4.ts";

const vcard = (...lines: Array<string>) => `${lines.join("\r\n")}\r\n`;

// Unfold before splitting: a base64 photo is always folded across many lines.
const lines = (out: string): Array<string> =>
	out
		.replace(/\r?\n[ \t]/gu, "")
		.split(/\r?\n/u)
		.map((l) => l.trim())
		.filter((l) => l !== "");

const up = (text: string): Promise<Array<string>> =>
	Effect.runPromise(
		decodeVCard(text).pipe(
			Effect.map(upgradeToV4),
			Effect.flatMap(encodeVCard),
		),
	).then(lines);

const down = (text: string): Promise<Array<string>> =>
	Effect.runPromise(
		decodeVCard(text).pipe(
			Effect.map(downgradeToV3),
			Effect.flatMap(encodeVCard),
		),
	).then(lines);

const photoOf = (ls: Array<string>): string =>
	ls.find((l) => l.startsWith("PHOTO")) ?? "";

// A one-pixel JPEG's worth of base64 is unnecessary — any payload exercises the
// same path, and a short one keeps the expectations readable.
const B64 = "/9j/4AAQSkZJRgABAQ";

describe("inline media (ENCODING=b ↔ data: URI)", () => {
	it("folds a 3.0 ENCODING=b photo into a data: URI", async () => {
		const photo = photoOf(
			await up(
				vcard(
					"BEGIN:VCARD",
					"VERSION:3.0",
					"FN:Jane",
					`PHOTO;ENCODING=b;TYPE=JPEG:${B64}`,
					"END:VCARD",
				),
			),
		);
		expect(photo).toBe(`PHOTO:data:image/jpeg;base64,${B64}`);
	});

	it("handles vCard 2.1's ENCODING=BASE64 with a bare format parameter", async () => {
		const photo = photoOf(
			await up(
				vcard(
					"BEGIN:VCARD",
					"VERSION:2.1",
					"FN:Jane",
					`PHOTO;ENCODING=BASE64;PNG:${B64}`,
					"END:VCARD",
				),
			),
		);
		expect(photo).toBe(`PHOTO:data:image/png;base64,${B64}`);
	});

	it("prefers an explicit MEDIATYPE over the format TYPE token", async () => {
		const photo = photoOf(
			await up(
				vcard(
					"BEGIN:VCARD",
					"VERSION:3.0",
					"FN:Jane",
					`PHOTO;ENCODING=b;TYPE=JPEG;MEDIATYPE=image/webp:${B64}`,
					"END:VCARD",
				),
			),
		);
		expect(photo).toBe(`PHOTO:data:image/webp;base64,${B64}`);
	});

	it("defaults to JPEG when no format is stated", async () => {
		const photo = photoOf(
			await up(
				vcard(
					"BEGIN:VCARD",
					"VERSION:3.0",
					"FN:Jane",
					`PHOTO;ENCODING=b:${B64}`,
					"END:VCARD",
				),
			),
		);
		expect(photo).toBe(`PHOTO:data:image/jpeg;base64,${B64}`);
	});

	it("preserves unrelated parameters such as Apple's crop rectangle", async () => {
		const crop = "ABClipRect_1&62&92&111&111&9PrNxogAXek=";
		const photo = photoOf(
			await up(
				vcard(
					"BEGIN:VCARD",
					"VERSION:3.0",
					"FN:Jane",
					`PHOTO;ENCODING=b;TYPE=JPEG;X-ABCROP-RECTANGLE=${crop}:${B64}`,
					"END:VCARD",
				),
			),
		);
		expect(photo).toContain(`X-ABCROP-RECTANGLE=${crop}`);
		expect(photo).toContain(`:data:image/jpeg;base64,${B64}`);
	});

	it("leaves a remote photo URL alone in both directions", async () => {
		const url = "https://example.com/jane.jpg";
		expect(
			photoOf(
				await up(
					vcard(
						"BEGIN:VCARD",
						"VERSION:3.0",
						"FN:Jane",
						`PHOTO:${url}`,
						"END:VCARD",
					),
				),
			),
		).toBe(`PHOTO:${url}`);
		expect(
			photoOf(
				await down(
					vcard(
						"BEGIN:VCARD",
						"VERSION:4.0",
						"FN:Jane",
						`PHOTO:${url}`,
						"END:VCARD",
					),
				),
			),
		).toBe(`PHOTO:${url}`);
	});

	it("unfolds a data: URI back to ENCODING=b for a 3.0 client", async () => {
		const photo = photoOf(
			await down(
				vcard(
					"BEGIN:VCARD",
					"VERSION:4.0",
					"FN:Jane",
					`PHOTO:data:image/png;base64,${B64}`,
					"END:VCARD",
				),
			),
		);
		expect(photo).toContain("ENCODING=b");
		expect(photo).toContain("TYPE=PNG");
		expect(photo).toContain(`:${B64}`);
		expect(photo).not.toContain("data:");
	});

	it("round-trips 3.0 → 4.0 → 3.0 without changing the payload", async () => {
		const original = vcard(
			"BEGIN:VCARD",
			"VERSION:3.0",
			"FN:Jane",
			`PHOTO;ENCODING=b;TYPE=JPEG:${B64}`,
			"END:VCARD",
		);
		const roundTripped = photoOf(await down((await up(original)).join("\r\n")));
		expect(roundTripped).toContain("ENCODING=b");
		expect(roundTripped).toContain("TYPE=JPEG");
		expect(roundTripped).toContain(`:${B64}`);
	});
});
