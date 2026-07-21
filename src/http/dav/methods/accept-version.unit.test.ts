import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { parseAcceptVCardVersion } from "./accept-version.ts";

describe("parseAcceptVCardVersion", () => {
	it("returns undefined when no Accept header is present", () => {
		expect(parseAcceptVCardVersion(null)).toBeUndefined();
	});

	it("returns undefined for a bare text/vcard with no version param", () => {
		expect(parseAcceptVCardVersion("text/vcard")).toBeUndefined();
	});

	it("reads a version param off a text/vcard range", () => {
		expect(parseAcceptVCardVersion("text/vcard; version=3.0")).toBe("3.0");
		expect(parseAcceptVCardVersion("text/vcard;version=4.0")).toBe("4.0");
	});

	it("ignores an unsupported version value", () => {
		expect(parseAcceptVCardVersion("text/vcard; version=2.1")).toBeUndefined();
	});

	it("strips quotes and is case-insensitive on the media type", () => {
		expect(parseAcceptVCardVersion('TEXT/VCARD; version="3.0"')).toBe("3.0");
	});

	it("only honors the version on a text/vcard range, not another type", () => {
		expect(
			parseAcceptVCardVersion("text/calendar; version=3.0, text/vcard"),
		).toBeUndefined();
	});
});
