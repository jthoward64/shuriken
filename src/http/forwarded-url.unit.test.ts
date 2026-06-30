import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Option } from "effect";
import { resolveForwardedUrl } from "#src/http/forwarded-url.ts";

const ip = Option.some("10.0.0.1");

const resolve = (
	raw: string,
	headers: Record<string, string>,
	clientIp = ip,
	trustedProxies = "*",
): URL =>
	resolveForwardedUrl(
		new URL(raw),
		new Headers(headers),
		clientIp,
		trustedProxies,
	);

describe("resolveForwardedUrl", () => {
	it("overrides scheme from X-Forwarded-Proto for a trusted proxy", () => {
		const url = resolve("http://dav.example.com/dav/", {
			"x-forwarded-proto": "https",
		});
		expect(url.origin).toBe("https://dav.example.com");
		expect(url.pathname).toBe("/dav/");
	});

	it("overrides host from X-Forwarded-Host and drops the internal port", () => {
		const url = resolve("http://internal:8080/dav/", {
			"x-forwarded-proto": "https",
			"x-forwarded-host": "dav.example.com",
		});
		expect(url.origin).toBe("https://dav.example.com");
	});

	it("uses the first value when headers carry a proxy chain", () => {
		const url = resolve("http://internal/dav/", {
			"x-forwarded-proto": "https, http",
			"x-forwarded-host": "dav.example.com, internal",
		});
		expect(url.origin).toBe("https://dav.example.com");
	});

	it("preserves the search string", () => {
		const url = resolve("http://dav.example.com/timezones?action=get", {
			"x-forwarded-proto": "https",
		});
		expect(url.search).toBe("?action=get");
	});

	it("ignores forwarded headers from an untrusted client", () => {
		const url = resolve(
			"http://dav.example.com/dav/",
			{ "x-forwarded-proto": "https", "x-forwarded-host": "evil.example.com" },
			Option.some("203.0.113.9"),
			"10.0.0.0/8",
		);
		expect(url.origin).toBe("http://dav.example.com");
	});

	it("ignores an unrecognised proto value", () => {
		const url = resolve("http://dav.example.com/dav/", {
			"x-forwarded-proto": "ftp",
		});
		expect(url.protocol).toBe("http:");
	});

	it("returns the raw URL unchanged when no forwarded headers are present", () => {
		const url = resolve("http://dav.example.com/dav/", {});
		expect(url.origin).toBe("http://dav.example.com");
	});
});
