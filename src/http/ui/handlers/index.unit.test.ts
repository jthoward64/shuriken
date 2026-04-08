import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { indexHandler } from "./index.ts";

describe("indexHandler", () => {
	it("returns 200 with text/html content-type", async () => {
		const res = await Effect.runPromise(
			indexHandler(new Request("http://localhost/")),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
	});

	it("returns HTML body containing the page title", async () => {
		const res = await Effect.runPromise(
			indexHandler(new Request("http://localhost/")),
		);
		const body = await res.text();
		expect(body).toContain("shuriken");
		expect(body).toContain("<!DOCTYPE html>");
	});

	it("ignores the request path — always serves the same HTML", async () => {
		const r1 = await Effect.runPromise(
			indexHandler(new Request("http://localhost/")),
		);
		const r2 = await Effect.runPromise(
			indexHandler(new Request("http://localhost/ui")),
		);
		expect(await r1.text()).toBe(await r2.text());
	});
});
