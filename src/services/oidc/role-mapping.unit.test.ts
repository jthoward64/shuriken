import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Option } from "effect";
import { resolveRoleFromGroups } from "./role-mapping.ts";

const map = new Map<string, string>([
	["staff", "admin"],
	["it-admins", "super_admin"],
	["everyone", "normal"],
]);

describe("resolveRoleFromGroups", () => {
	it("returns None when no group maps to a role", () => {
		expect(
			Option.isNone(resolveRoleFromGroups(["unknown", "guests"], map)),
		).toBe(true);
	});

	it("maps a single matching group to its role", () => {
		expect(Option.getOrNull(resolveRoleFromGroups(["staff"], map))).toBe(
			"admin",
		);
	});

	it("picks the highest-privilege role among several matches", () => {
		expect(
			Option.getOrNull(
				resolveRoleFromGroups(["everyone", "staff", "it-admins"], map),
			),
		).toBe("super_admin");
	});

	it("is order-independent", () => {
		expect(
			Option.getOrNull(resolveRoleFromGroups(["it-admins", "staff"], map)),
		).toBe("super_admin");
		expect(
			Option.getOrNull(resolveRoleFromGroups(["staff", "it-admins"], map)),
		).toBe("super_admin");
	});

	it("returns None for an empty group list", () => {
		expect(Option.isNone(resolveRoleFromGroups([], map))).toBe(true);
	});
});
