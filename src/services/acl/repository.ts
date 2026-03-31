import type { InferSelectModel } from "drizzle-orm";
import type { Effect } from "effect";
import { Context } from "effect";
import type { casbinRule } from "#/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#/domain/errors.ts";
import type { DavPrivilege } from "#/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// AclRepository — data access for casbin_rule rows
//
// Casbin ptype values:
//   "p"  — policy:   (subject, resource, privilege, effect)
//   "g"  — role:     (user, role) — principal group membership
//   "g2" — privilege containment: (aggregate, contained)
// ---------------------------------------------------------------------------

export type CasbinRuleRow = InferSelectModel<typeof casbinRule>;

export type PolicyRule = {
  readonly ptype: "p";
  readonly subject: string; // principal URL or special (DAV:all, etc.)
  readonly resource: string; // resource URL
  readonly privilege: DavPrivilege;
  readonly effect: "allow" | "deny";
};

export type RoleRule = {
  readonly ptype: "g";
  readonly user: string;
  readonly role: string;
};

export interface AclRepositoryShape {
  readonly getRulesForResource: (
    resourceUrl: string,
  ) => Effect<ReadonlyArray<CasbinRuleRow>, DatabaseError>;
  readonly insertRule: (
    rule: PolicyRule | RoleRule,
  ) => Effect<void, DatabaseError>;
  readonly deleteRulesForResource: (
    resourceUrl: string,
  ) => Effect<void, DatabaseError>;
  /** Raw check: does any "p" rule allow this (subject, resource, privilege)? */
  readonly hasAllow: (
    subject: string,
    resourceUrl: string,
    privilege: DavPrivilege,
  ) => Effect<boolean, DatabaseError>;
}

export class AclRepository extends Context.Tag("AclRepository")<
  AclRepository,
  AclRepositoryShape
>() {}
