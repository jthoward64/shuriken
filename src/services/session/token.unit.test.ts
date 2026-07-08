import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { generateSessionToken, sha256Hex } from "./token.ts";

describe("generateSessionToken", () => {
	it("produces a URL-safe string with no padding", () => {
		const t = generateSessionToken();
		expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(t).not.toContain("=");
	});

	it("returns a different value each call", () => {
		expect(generateSessionToken()).not.toBe(generateSessionToken());
	});
});

describe("sha256Hex", () => {
	it("matches the known SHA-256 vector for 'abc'", async () => {
		expect(await sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("is deterministic and 64 hex chars", async () => {
		const a = await sha256Hex("shuriken");
		const b = await sha256Hex("shuriken");
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});
});
