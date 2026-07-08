import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Option } from "effect";
import {
	clearSessionCookie,
	getCookie,
	SESSION_COOKIE,
	serializeCookie,
} from "./cookie.ts";

const headersWith = (cookie?: string): Headers => {
	const h = new Headers();
	if (cookie !== undefined) {
		h.set("cookie", cookie);
	}
	return h;
};

describe("getCookie", () => {
	it("returns None when no Cookie header is present", () => {
		expect(Option.isNone(getCookie(headersWith(), "x"))).toBe(true);
	});

	it("reads a single cookie value", () => {
		const v = getCookie(headersWith("shuriken_session=abc123"), SESSION_COOKIE);
		expect(Option.getOrNull(v)).toBe("abc123");
	});

	it("reads one cookie among several", () => {
		const v = getCookie(
			headersWith("a=1; shuriken_session=tok; b=2"),
			SESSION_COOKIE,
		);
		expect(Option.getOrNull(v)).toBe("tok");
	});

	it("returns None for a missing cookie name", () => {
		expect(
			Option.isNone(getCookie(headersWith("a=1; b=2"), SESSION_COOKIE)),
		).toBe(true);
	});

	it("returns None for an empty cookie value", () => {
		expect(
			Option.isNone(
				getCookie(headersWith("shuriken_session="), SESSION_COOKIE),
			),
		).toBe(true);
	});

	it("keeps the first value when a name repeats", () => {
		const v = getCookie(headersWith("x=first; x=second"), "x");
		expect(Option.getOrNull(v)).toBe("first");
	});
});

describe("serializeCookie", () => {
	it("sets HttpOnly, SameSite=Lax and Path=/ by default", () => {
		const c = serializeCookie("s", "v", { secure: false });
		expect(c).toContain("s=v");
		expect(c).toContain("Path=/");
		expect(c).toContain("SameSite=Lax");
		expect(c).toContain("HttpOnly");
		expect(c).not.toContain("Secure");
	});

	it("adds Secure when requested", () => {
		expect(serializeCookie("s", "v", { secure: true })).toContain("Secure");
	});

	it("includes Max-Age when provided", () => {
		expect(
			serializeCookie("s", "v", { secure: false, maxAgeSeconds: 3600 }),
		).toContain("Max-Age=3600");
	});

	it("omits HttpOnly when explicitly disabled", () => {
		expect(
			serializeCookie("s", "v", { secure: false, httpOnly: false }),
		).not.toContain("HttpOnly");
	});
});

describe("clearSessionCookie", () => {
	it("expires the session cookie with Max-Age=0", () => {
		const c = clearSessionCookie(true);
		expect(c).toContain(`${SESSION_COOKIE}=`);
		expect(c).toContain("Max-Age=0");
		expect(c).toContain("Secure");
	});
});
