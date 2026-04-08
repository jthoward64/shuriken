import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { staticHandler } from "./static.ts";

describe("staticHandler", () => {
	it("returns 404 (placeholder — no static assets served yet)", async () => {
		const res = await Effect.runPromise(
			staticHandler(new Request("http://localhost/static/app.js")),
		);
		expect(res.status).toBe(404);
	});

	it("returns 404 for any path", async () => {
		const res = await Effect.runPromise(
			staticHandler(new Request("http://localhost/static/styles.css")),
		);
		expect(res.status).toBe(404);
	});
});
