import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { normalizeRichText, sanitizeRichText } from "./rich-text.ts";

const run = <A>(eff: Effect.Effect<A, unknown>): Promise<A> =>
	Effect.runPromise(eff as Effect.Effect<A, never>);

describe("sanitizeRichText", () => {
	it("keeps the editor's own vocabulary", async () => {
		const html =
			"<p>Hello <strong>world</strong></p><ul><li>one</li><li>two</li></ul>";
		expect(await run(sanitizeRichText(html))).toBe(html);
	});

	it("drops scripts and their contents", async () => {
		const out = await run(
			sanitizeRichText("<p>safe</p><script>alert(1)</script>"),
		);
		expect(out).toBe("<p>safe</p>");
	});

	it("strips event-handler attributes", async () => {
		const out = await run(sanitizeRichText('<p onclick="steal()">hi</p>'));
		expect(out).toBe("<p>hi</p>");
	});

	it("strips hrefs with a disallowed scheme", async () => {
		const out = await run(
			sanitizeRichText('<a href="javascript:alert(1)">x</a>'),
		);
		expect(out).not.toContain("javascript");
	});

	it("keeps http, mailto and tel links and adds rel", async () => {
		const out = await run(
			sanitizeRichText('<a href="https://example.com">link</a>'),
		);
		expect(out).toContain('href="https://example.com"');
		expect(out).toContain('rel="noopener noreferrer"');
	});

	it("rewrites legacy presentational tags", async () => {
		const out = await run(sanitizeRichText("<b>bold</b> and <i>italic</i>"));
		expect(out).toBe("<strong>bold</strong> and <em>italic</em>");
	});
});

describe("normalizeRichText", () => {
	it("derives plain text preserving list structure", async () => {
		const { html, text } = await run(
			normalizeRichText("<p>Agenda</p><ul><li>one</li><li>two</li></ul>"),
		);
		expect(html).toBe("<p>Agenda</p><ul><li>one</li><li>two</li></ul>");
		expect(text).toContain("Agenda");
		expect(text).toContain("one");
		expect(text).toContain("two");
	});

	it("renders a link as text plus its URL", async () => {
		const { text } = await run(
			normalizeRichText('<p>See <a href="https://example.com">docs</a></p>'),
		);
		expect(text).toContain("docs");
		expect(text).toContain("https://example.com");
	});

	it("treats markup carrying no text as empty", async () => {
		for (const blank of ["", "<p></p>", "<p><br></p>", "<p>&nbsp;</p>"]) {
			expect(await run(normalizeRichText(blank))).toEqual({
				html: "",
				text: "",
			});
		}
	});

	it("treats a stripped-to-nothing payload as empty", async () => {
		expect(await run(normalizeRichText("<script>alert(1)</script>"))).toEqual({
			html: "",
			text: "",
		});
	});
});
