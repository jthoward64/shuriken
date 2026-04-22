import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { BunFileService } from "#src/platform/file.ts";
import { staticHandler } from "./static.ts";

const die = () => Effect.die("stub");

const noFilesLayer = Layer.succeed(BunFileService, {
	readText: die,
	readBytes: die,
	exists: () => Effect.succeed(false),
	mimeType: () => undefined,
	glob: () => Effect.succeed([]),
});

const run = (path: string): Promise<Response> =>
	Effect.runPromise(
		Effect.provide(staticHandler(new Request(`http://localhost${path}`)), noFilesLayer),
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
});
