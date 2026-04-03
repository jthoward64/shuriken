import { describe, expect, it } from "bun:test";
import { Option } from "effect";
import { isClientTrusted } from "./proxy.ts";

// ---------------------------------------------------------------------------
// isClientTrusted — pure function unit tests
// ---------------------------------------------------------------------------

describe("isClientTrusted", () => {
	it("returns true when trustedProxies is '*'", () => {
		expect(isClientTrusted(Option.none(), "*")).toBe(true);
		expect(isClientTrusted(Option.some("1.2.3.4"), "*")).toBe(true);
	});

	it("returns false when clientIp is None and proxies is a list", () => {
		expect(isClientTrusted(Option.none(), "127.0.0.1,::1")).toBe(false);
	});

	it("returns true when clientIp matches an entry", () => {
		expect(isClientTrusted(Option.some("127.0.0.1"), "127.0.0.1,::1")).toBe(true);
	});

	it("returns false when clientIp matches no entry", () => {
		expect(isClientTrusted(Option.some("10.0.0.1"), "127.0.0.1,::1")).toBe(false);
	});

	it("trims whitespace around comma-separated entries", () => {
		expect(
			isClientTrusted(Option.some("10.0.0.1"), " 10.0.0.1 , 192.168.1.1 "),
		).toBe(true);
	});
});
