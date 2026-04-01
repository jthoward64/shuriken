import type { InferSelectModel } from "drizzle-orm";
import type { Effect } from "effect";
import { Context } from "effect";
import type { casbinRule } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { ResourceUrl } from "#src/domain/types/path.ts";

// ---------------------------------------------------------------------------
// AclRepository — data access for casbin_rule rows
//
// Casbin ptype values:
//   "p"  — policy:   (subject, resource, privilege, effect)
//   "g"  — role:     (user, role) — principal group membership
//   "g2" — privilege containment: (aggregate, contained)
// ---------------------------------------------------------------------------

export type CasbinRuleRow = InferSelectModel<typeof casbinRule>;

export interface PolicyRule {
	readonly ptype: "p";
	readonly subject: string; // principal URL or special (DAV:all, etc.)
	readonly resource: ResourceUrl;
	readonly privilege: DavPrivilege;
	readonly effect: "allow" | "deny";
}

export interface RoleRule {
	readonly ptype: "g";
	readonly user: string;
	readonly role: string;
}

export interface AclRepositoryShape {
	readonly getRulesForResource: (
		resourceUrl: ResourceUrl,
	) => Effect.Effect<ReadonlyArray<CasbinRuleRow>, DatabaseError>;
	readonly insertRule: (
		rule: PolicyRule | RoleRule,
	) => Effect.Effect<void, DatabaseError>;
	readonly deleteRulesForResource: (
		resourceUrl: ResourceUrl,
	) => Effect.Effect<void, DatabaseError>;
	/** Raw check: does any "p" rule allow this (subject, resource, privilege)? */
	readonly hasAllow: (
		subject: string,
		resourceUrl: ResourceUrl,
		privilege: DavPrivilege,
	) => Effect.Effect<boolean, DatabaseError>;
}

export class AclRepository extends Context.Tag("AclRepository")<
	AclRepository,
	AclRepositoryShape
>() {}
