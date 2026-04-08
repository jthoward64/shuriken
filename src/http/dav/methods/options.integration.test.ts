import { describe, expect, it } from "bun:test";
import { options, singleUser } from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// RFC 4918 §5.1, RFC 4791 §5.1, RFC 6352 §6.1.1

describe("OPTIONS", () => {
	it("returns correct DAV capabilities on a principal path", async () => {
		const results = await runScript(
			[
				options("/dav/principals/test/", {
					as: "test",
					expect: {
						status: 200,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			expect(result.headers["dav"]).toContain("calendar-access");
			expect(result.headers["dav"]).toContain("addressbook");
			expect(result.headers["dav"]).toContain("extended-mkcol");
		}
	});

	it("returns correct DAV capabilities on a collection path", async () => {
		const results = await runScript(
			[
				options("/dav/principals/test/cal/primary/", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			expect(result.headers["dav"]).toContain("calendar-access");
		}
	});

	it("Allow header contains DAV-specific methods", async () => {
		const results = await runScript(
			[
				options("/dav/principals/test/", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			const allow = result.headers["allow"] ?? "";
			expect(allow).toContain("REPORT");
			expect(allow).toContain("MKCALENDAR");
			expect(allow).toContain("MKADDRESSBOOK");
		}
	});

	it("returns 404 on a new-collection (non-existent) path", async () => {
		const results = await runScript(
			[
				options("/dav/principals/test/cal/does-not-exist/", {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
