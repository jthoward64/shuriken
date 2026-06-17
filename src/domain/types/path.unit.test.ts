import { describe, expect, it } from "bun:test";
import { isValidInstanceSlug, isValidSlug } from "#src/domain/types/path.ts";

describe("isValidSlug (collection/principal slugs — tight)", () => {
	it("accepts the conservative charset", () => {
		for (const s of ["primary", "work-cal", "a.b_c", "X", "2026"]) {
			expect(isValidSlug(s), s).toBe(true);
		}
	});

	it("rejects @ and other special characters (stays tight)", () => {
		for (const s of ["uid@example.com", "a/b", "a b", "a&b", ".hidden", "x."]) {
			expect(isValidSlug(s), s).toBe(false);
		}
	});
});

describe("isValidInstanceSlug (object resource names — relaxed)", () => {
	it("accepts UID-derived names containing @", () => {
		for (const s of [
			"20010712T182145Z-123401@example.com.ics",
			"plain-123.ics",
			"uid@host.vcf",
			"a+b=c,d.ics",
		]) {
			expect(isValidInstanceSlug(s), s).toBe(true);
		}
	});

	it("still rejects path separators, traversal, and empties", () => {
		for (const s of ["", ".", "..", "a/b", "a\\b", "a b"]) {
			expect(isValidInstanceSlug(s), s).toBe(false);
		}
	});

	it("rejects names longer than 128 characters", () => {
		expect(isValidInstanceSlug("a".repeat(129))).toBe(false);
		expect(isValidInstanceSlug("a".repeat(128))).toBe(true);
	});
});
