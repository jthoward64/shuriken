import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { h } from "preact";
import { CALENDAR_ASSETS } from "./assets.tsx";
import { renderPage } from "./render.tsx";

// renderPage has no service requirements, so it runs directly. Content is built
// with `h` (not JSX) to keep this a `.ts` file the *.unit.test.ts glob matches.
const render = (opts: {
	headers: Headers;
	title: string;
	preload?: typeof CALENDAR_ASSETS;
}) => Effect.runPromise(renderPage(h("p", null, "hi"), opts));

describe("renderPage preload Link header", () => {
	it("advertises the always-present base assets on a full-page render", async () => {
		const res = await render({ headers: new Headers(), title: "Test" });
		const link = res.headers.get("Link");
		expect(link).toContain("</static/app.css>; rel=preload; as=style");
		expect(link).toContain("</static/ui.js>; rel=preload; as=script");
		expect(link).toContain(
			"</static/vendor/htmx.min.js>; rel=preload; as=script",
		);
	});

	it("appends page-specific preload assets after the base assets", async () => {
		const res = await render({
			headers: new Headers(),
			title: "Calendar",
			preload: CALENDAR_ASSETS,
		});
		const link = res.headers.get("Link") ?? "";
		// Base assets come first, then the page bundle in declared order.
		expect(link.indexOf("app.css")).toBeLessThan(link.indexOf("calendar.js"));
		expect(link).toContain("</static/calendar.js>; rel=preload; as=script");
		expect(link).toContain("</static/reorder.js>; rel=preload; as=script");
	});

	it("omits the Link header (and chrome) for HTMX fragment requests", async () => {
		const res = await render({
			headers: new Headers({ "HX-Request": "true" }),
			title: "Fragment",
		});
		expect(res.headers.get("Link")).toBeNull();
		const body = await res.text();
		expect(body).not.toContain("<!DOCTYPE html>");
	});
});
