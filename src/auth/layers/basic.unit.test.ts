import { describe, expect, it } from "bun:test";
import { Option, Redacted } from "effect";
import { parseBasicAuth } from "./basic.ts";

// ---------------------------------------------------------------------------
// parseBasicAuth — pure function unit tests
// ---------------------------------------------------------------------------

const makeHeaders = (value?: string): Headers => {
	const h = new Headers();
	if (value !== undefined) {
		h.set("Authorization", value);
	}
	return h;
};

const encode = (s: string) => btoa(s);

describe("parseBasicAuth", () => {
	it("returns None when Authorization header is absent", () => {
		expect(Option.isNone(parseBasicAuth(makeHeaders()))).toBe(true);
	});

	it("returns None when header does not start with 'Basic '", () => {
		expect(
			Option.isNone(
				parseBasicAuth(makeHeaders(`Bearer ${encode("alice:secret")}`)),
			),
		).toBe(true);
	});

	it("returns None when decoded value has no colon", () => {
		expect(
			Option.isNone(parseBasicAuth(makeHeaders(`Basic ${encode("nocolon")}`))),
		).toBe(true);
	});

	it("returns Some with correct username and password", () => {
		const result = parseBasicAuth(
			makeHeaders(`Basic ${encode("alice:secret")}`),
		);
		expect(Option.isSome(result)).toBe(true);
		const creds = Option.getOrThrow(result);
		expect(creds.username).toBe("alice");
		expect(Redacted.value(creds.password)).toBe("secret");
	});

	it("password may contain colons — only the first colon splits user:pass", () => {
		const result = parseBasicAuth(
			makeHeaders(`Basic ${encode("alice:pass:with:colons")}`),
		);
		expect(Option.isSome(result)).toBe(true);
		const creds = Option.getOrThrow(result);
		expect(creds.username).toBe("alice");
		expect(Redacted.value(creds.password)).toBe("pass:with:colons");
	});
});
