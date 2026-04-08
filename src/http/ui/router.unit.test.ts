import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { uiRouter } from "./router.ts";

const req = (path: string) => new Request(`http://localhost${path}`);

describe("uiRouter", () => {
	it("routes / to indexHandler (200 with HTML)", async () => {
		const res = await Effect.runPromise(uiRouter(req("/")));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
	});

	it("routes /ui to indexHandler (200 with HTML)", async () => {
		const res = await Effect.runPromise(uiRouter(req("/ui")));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
	});

	it("routes /static/* to staticHandler (404 placeholder)", async () => {
		const res = await Effect.runPromise(uiRouter(req("/static/app.js")));
		expect(res.status).toBe(404);
	});

	it("routes /static/ (trailing slash) to staticHandler", async () => {
		const res = await Effect.runPromise(uiRouter(req("/static/")));
		expect(res.status).toBe(404);
	});

	it("returns 404 for unknown paths", async () => {
		const res = await Effect.runPromise(uiRouter(req("/unknown")));
		expect(res.status).toBe(404);
	});

	it("returns 404 for /ui/ sub-paths (not handled by uiRouter)", async () => {
		// /ui/something is not matched by the current router (only exact /ui)
		const res = await Effect.runPromise(uiRouter(req("/ui/dashboard")));
		expect(res.status).toBe(404);
	});
});
