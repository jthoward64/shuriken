import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import type { AceRow } from "#src/services/acl/repository.ts";
import {
	basicTierForGrant,
	collapseToBasicTiers,
	isRepresentableInBasicTiers,
	tiersFor,
} from "./share-tiers.ts";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

let aceCounter = 0;
const ace = (overrides: Partial<AceRow>): AceRow => {
	aceCounter += 1;
	return {
		id: `ace-${aceCounter}`,
		resourceType: "collection",
		resourceId: "resource-1",
		principalType: "principal",
		principalId: "principal-1",
		privilege: "DAV:read",
		grantDeny: "grant",
		protected: false,
		ordinal: 0,
		updatedAt: new Date(0),
		...overrides,
	} as AceRow;
};

const grant = (
	principalId: string,
	privilege: string,
	overrides: Partial<AceRow> = {},
): AceRow =>
	ace({
		principalId: principalId as AceRow["principalId"],
		privilege,
		...overrides,
	});

describe("tiersFor", () => {
	it("returns view/edit only for instances, regardless of isCalendar", () => {
		expect(tiersFor("instance", true).map((t) => t.tier)).toEqual([
			"view",
			"edit",
		]);
		expect(tiersFor("instance", false).map((t) => t.tier)).toEqual([
			"view",
			"edit",
		]);
	});

	it("returns all 4 tiers for calendar collections", () => {
		expect(tiersFor("collection", true).map((t) => t.tier)).toEqual([
			"free_busy",
			"view",
			"edit",
			"manage",
		]);
	});

	it("returns view/edit only for address book collections", () => {
		expect(tiersFor("collection", false).map((t) => t.tier)).toEqual([
			"view",
			"edit",
		]);
	});
});

describe("isRepresentableInBasicTiers", () => {
	it("is true for an empty ACE list", () => {
		expect(isRepresentableInBasicTiers([], "collection", true)).toBe(true);
	});

	it("is true when every principal's set exactly matches a tier", () => {
		const aces = [
			grant("p1", "DAV:read"),
			grant("p2", "DAV:read"),
			grant("p2", "DAV:write"),
			grant("p3", "DAV:read"),
			grant("p3", "DAV:write"),
			grant("p3", "DAV:write-acl"),
		];
		expect(isRepresentableInBasicTiers(aces, "collection", true)).toBe(true);
	});

	it("is true for an exact free_busy grant (collection, calendar)", () => {
		const aces = [grant("p1", "CALDAV:read-free-busy")];
		expect(isRepresentableInBasicTiers(aces, "collection", true)).toBe(true);
	});

	it("is false when a grantee has an extra privilege beyond a tier", () => {
		const aces = [
			grant("p1", "DAV:read"),
			grant("p1", "CALDAV:schedule-send-freebusy"),
		];
		expect(isRepresentableInBasicTiers(aces, "collection", true)).toBe(false);
	});

	it("is false when a grantee is missing a privilege the tier requires", () => {
		// "edit" requires DAV:read + DAV:write; this principal only has write.
		const aces = [grant("p1", "DAV:write")];
		expect(isRepresentableInBasicTiers(aces, "collection", true)).toBe(false);
	});

	it("is false when any deny ACE is present", () => {
		const aces = [
			grant("p1", "DAV:read"),
			grant("p2", "DAV:read", { grantDeny: "deny" }),
		];
		expect(isRepresentableInBasicTiers(aces, "collection", true)).toBe(false);
	});

	it("is false when a pseudo-principal ACE is present", () => {
		const aces = [
			grant("p1", "DAV:read"),
			ace({
				principalType: "authenticated",
				principalId: null,
				privilege: "DAV:read",
			}),
		];
		expect(isRepresentableInBasicTiers(aces, "collection", true)).toBe(false);
	});

	it("treats a group principal's ACE the same as a user principal's (exact tier match)", () => {
		// Groups aren't distinguishable from users at this layer by
		// principalType alone (both are "principal") — this codebase's Basic
		// picker excludes groups only by never offering one in the search UI,
		// not via a special case here. A group grant that exactly matches a
		// tier is representable, same as a user's would be.
		const aces = [grant("p1", "DAV:read"), grant("group-1", "DAV:read")];
		expect(isRepresentableInBasicTiers(aces, "collection", true)).toBe(true);
	});

	it("ignores protected ACEs entirely", () => {
		const aces = [
			grant("p1", "DAV:read"),
			grant("p2", "DAV:all", { protected: true, grantDeny: "deny" }),
		];
		expect(isRepresentableInBasicTiers(aces, "collection", true)).toBe(true);
	});

	it("is false for a bare DAV:all grant (not the expanded manage set)", () => {
		const aces = [grant("p1", "DAV:all")];
		expect(isRepresentableInBasicTiers(aces, "collection", true)).toBe(false);
	});
});

describe("basicTierForGrant", () => {
	it("matches view/edit/manage/free_busy exactly", () => {
		expect(basicTierForGrant(["DAV:read"], "collection", true)).toBe("view");
		expect(
			basicTierForGrant(["DAV:read", "DAV:write"], "collection", true),
		).toBe("edit");
		expect(
			basicTierForGrant(
				["DAV:read", "DAV:write", "DAV:write-acl"],
				"collection",
				true,
			),
		).toBe("manage");
		expect(
			basicTierForGrant(["CALDAV:read-free-busy"], "collection", true),
		).toBe("free_busy");
	});

	it("returns undefined for a non-matching set", () => {
		expect(
			basicTierForGrant(["DAV:write"], "collection", true),
		).toBeUndefined();
	});
});

describe("collapseToBasicTiers", () => {
	it("drops deny ACEs", () => {
		const aces = [grant("p1", "DAV:read", { grantDeny: "deny" })];
		expect(collapseToBasicTiers(aces)).toEqual([]);
	});

	it("drops pseudo-principal ACEs", () => {
		const aces = [
			ace({ principalType: "all", principalId: null, privilege: "DAV:read" }),
		];
		expect(collapseToBasicTiers(aces)).toEqual([]);
	});

	it("leaves protected ACEs out of the collapsed grant list (persisted separately)", () => {
		const aces = [grant("p1", "DAV:all", { protected: true })];
		expect(collapseToBasicTiers(aces)).toEqual([]);
	});

	it("rounds a superset of privileges up to the correct tier", () => {
		// read + write + bind: bind isn't part of any tier's own set, but
		// shouldn't block matching edit (edit's own set — read+write — is a
		// subset of this grantee's union).
		const aces = [
			grant("p1", "DAV:read"),
			grant("p1", "DAV:write"),
			grant("p1", "DAV:bind"),
		];
		expect(collapseToBasicTiers(aces)).toEqual([
			{ principalId: "p1", tier: "edit" },
		]);
	});

	it("rounds up to manage when write-acl is present", () => {
		const aces = [
			grant("p1", "DAV:read"),
			grant("p1", "DAV:write"),
			grant("p1", "DAV:write-acl"),
		];
		expect(collapseToBasicTiers(aces)).toEqual([
			{ principalId: "p1", tier: "manage" },
		]);
	});

	it("floors to view when no tier's privileges overlap the grant", () => {
		const aces = [grant("p1", "DAV:read-acl")];
		expect(collapseToBasicTiers(aces)).toEqual([
			{ principalId: "p1", tier: "view" },
		]);
	});

	it("never collapses onto free_busy via the round-up path", () => {
		// A lone CALDAV:read-free-busy grant doesn't overlap view/edit/manage's
		// own canonical sets, so it floors to view rather than being (mis)mapped
		// to free_busy — free_busy only comes from the exact-match check.
		const aces = [grant("p1", "CALDAV:read-free-busy")];
		expect(collapseToBasicTiers(aces)).toEqual([
			{ principalId: "p1", tier: "view" },
		]);
	});

	it("is idempotent: collapsing an already-representable grant set yields the same tier", () => {
		const aces = [grant("p1", "DAV:read"), grant("p1", "DAV:write")];
		const collapsed = collapseToBasicTiers(aces);
		expect(collapsed).toEqual([{ principalId: "p1", tier: "edit" }]);
		// Re-collapsing the canonical "edit" ACE set produces the same result.
		expect(collapseToBasicTiers(aces)).toEqual(collapsed);
	});

	it("handles multiple independent principals in one call", () => {
		const aces = [
			grant("p1", "DAV:read"),
			grant("p2", "DAV:read"),
			grant("p2", "DAV:write"),
		];
		const result = collapseToBasicTiers(aces);
		expect(result).toContainEqual({ principalId: "p1", tier: "view" });
		expect(result).toContainEqual({ principalId: "p2", tier: "edit" });
		expect(result).toHaveLength(2);
	});
});
