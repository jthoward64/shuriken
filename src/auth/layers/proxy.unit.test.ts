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

	it("matches IPv4 address inside a CIDR block", () => {
		expect(isClientTrusted(Option.some("192.168.1.50"), "192.168.1.0/24")).toBe(true);
		expect(isClientTrusted(Option.some("192.168.2.1"), "192.168.1.0/24")).toBe(false);
	});

	it("matches IPv4 /32 CIDR as exact match", () => {
		expect(isClientTrusted(Option.some("10.0.0.1"), "10.0.0.1/32")).toBe(true);
		expect(isClientTrusted(Option.some("10.0.0.2"), "10.0.0.1/32")).toBe(false);
	});

	it("matches exact IPv6 address", () => {
		expect(isClientTrusted(Option.some("::1"), "::1")).toBe(true);
		expect(isClientTrusted(Option.some("::2"), "::1")).toBe(false);
	});

	it("matches IPv6 address inside a CIDR block", () => {
		expect(isClientTrusted(Option.some("fd00::1"), "fd00::/8")).toBe(true);
		expect(isClientTrusted(Option.some("fe00::1"), "fd00::/8")).toBe(false);
	});

	it("matches IPv6 /128 CIDR as exact match", () => {
		expect(isClientTrusted(Option.some("2001:db8::1"), "2001:db8::1/128")).toBe(true);
		expect(isClientTrusted(Option.some("2001:db8::2"), "2001:db8::1/128")).toBe(false);
	});

	it("handles mixed IPv4 and IPv6 CIDR entries", () => {
		const proxies = "10.0.0.0/8,fd00::/8";
		expect(isClientTrusted(Option.some("10.1.2.3"), proxies)).toBe(true);
		expect(isClientTrusted(Option.some("fd00::cafe"), proxies)).toBe(true);
		expect(isClientTrusted(Option.some("172.16.0.1"), proxies)).toBe(false);
		expect(isClientTrusted(Option.some("fe80::1"), proxies)).toBe(false);
	});
});
