import { describe, expect, it } from "bun:test";
import {
	PROPFIND_ALLPROP,
	propfind,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

describe("default collections", () => {
	it("provisioned user has a primary calendar collection", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_ALLPROP, {
					as: "test",
					headers: { Depth: "0" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("provisioned user has a primary address book collection", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/card/primary/", PROPFIND_ALLPROP, {
					as: "test",
					headers: { Depth: "0" },
				}),
			],
			singleUser(),
		);

		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
