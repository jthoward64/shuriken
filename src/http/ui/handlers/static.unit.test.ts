import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Layer } from "effect";
import { FileService } from "#src/platform/file.ts";
import { staticHandler } from "./static.ts";

const die = () => Effect.die("stub");

const noFilesLayer = Layer.succeed(FileService, {
	readText: die,
	readBytes: die,
	exists: () => Effect.succeed(false),
	mimeType: () => undefined,
	glob: () => Effect.succeed([]),
});

const CONTENT = new TextEncoder().encode("console.log('hi')");

const oneFileLayer = Layer.succeed(FileService, {
	readText: die,
	readBytes: () => Effect.succeed(CONTENT),
	exists: () => Effect.succeed(true),
	mimeType: () => "text/javascript; charset=utf-8",
	glob: () => Effect.succeed([]),
});

const run = (
	path: string,
	layer: typeof noFilesLayer = noFilesLayer,
	headers?: HeadersInit,
): Promise<Response> =>
	Effect.runPromise(
		Effect.provide(
			staticHandler(new Request(`http://localhost${path}`, { headers })),
			layer,
		),
	);

describe("staticHandler", () => {
	it("returns 404 when file does not exist", async () => {
		const res = await run("/static/app.js");
		expect(res.status).toBe(404);
	});

	it("returns 404 for any path when no files exist", async () => {
		const res = await run("/static/styles.css");
		expect(res.status).toBe(404);
	});

	it("sets a strong ETag and Cache-Control on a served file", async () => {
		const res = await run("/static/vendor/htmx.min.js", oneFileLayer);
		expect(res.status).toBe(200);
		expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{16}"$/);
		expect(res.headers.get("Cache-Control")).toBe(
			"public, max-age=300, must-revalidate",
		);
	});

	it("returns 304 when If-None-Match matches the computed ETag", async () => {
		const first = await run("/static/vendor/htmx.min.js", oneFileLayer);
		const etag = first.headers.get("ETag");
		expect(etag).not.toBeNull();

		const second = await run("/static/vendor/htmx.min.js", oneFileLayer, {
			"If-None-Match": etag ?? "",
		});
		expect(second.status).toBe(304);
		expect(second.headers.get("ETag")).toBe(etag);
	});
});
