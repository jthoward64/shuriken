import { describe, expect, it } from "bun:test";
import { singleUser } from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Well-known URL discovery — RFC 6764 §5
//
// /.well-known/caldav  and /.well-known/carddav  must redirect (301) to the
// DAV context path so that auto-discovery clients can find the server without
// knowing the path up-front.
// ---------------------------------------------------------------------------

describe("well-known redirect", () => {
	// RFC 6764 §5: GET or PROPFIND to /.well-known/caldav must return a redirect.
	it("GET /.well-known/caldav returns 301 to /dav/", async () => {
		const results = await runScript(
			[
				{
					name: "GET /.well-known/caldav",
					method: "GET" as const,
					path: "/.well-known/caldav",
					expect: { status: 301 },
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		expect(results[0]?.headers.location).toContain("/dav/");
	});

	it("GET /.well-known/carddav returns 301 to /dav/", async () => {
		const results = await runScript(
			[
				{
					name: "GET /.well-known/carddav",
					method: "GET" as const,
					path: "/.well-known/carddav",
					expect: { status: 301 },
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		expect(results[0]?.headers.location).toContain("/dav/");
	});

	// OPTIONS on well-known must also redirect — clients perform OPTIONS for
	// capability discovery before following the redirect.
	it("OPTIONS /.well-known/caldav returns 301", async () => {
		const results = await runScript(
			[
				{
					name: "OPTIONS /.well-known/caldav",
					method: "OPTIONS" as const,
					path: "/.well-known/caldav",
					expect: { status: 301 },
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
