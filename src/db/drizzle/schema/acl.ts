import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	uuid,
} from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { principal } from "./principal";
import { timestampTz } from "./types";

// ---------------------------------------------------------------------------
// dav_acl — RFC 3744 Access Control List
//
// Each row is one Access Control Entry (ACE) on a DAV resource.
// Resources are identified polymorphically via (resource_type, resource_id).
//
// Principal matching:
//   'all'             — matches every request (authenticated or not)
//   'authenticated'   — matches any authenticated principal
//   'unauthenticated' — matches unauthenticated requests
//   'self'            — matches the principal resource itself
//   'principal'       — matches the specific principal_id (+ group membership)
//
// Privilege evaluation:
//   - Aggregate privileges (DAV:write, DAV:all) are expanded in application code.
//   - Since DAV:acl-restrictions advertises <grant-only/>, only 'grant' ACEs
//     are supported via the ACL method; deny ACEs are reserved for server use.
//   - protected = true marks server-generated ACEs that the ACL method cannot remove.
//   - Inherited ACEs from parent collections are not stored; they are computed
//     at query time by walking dav_collection.parent_collection_id.
//
// Sync token URN format (RFC 6578): urn:shuriken:sync:{collection_uuid}:{synctoken_integer}
// ---------------------------------------------------------------------------

export const davAcl = pgTable(
	"dav_acl",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		// Resource being controlled (polymorphic — no DB-level FK)
		resourceType: text("resource_type").notNull(),
		resourceId: uuid("resource_id").notNull().$type<UuidString>(),
		// Principal matching
		principalType: text("principal_type").notNull(),
		principalId: uuid("principal_id")
			.references(() => principal.id, {
				onDelete: "cascade",
			})
			.$type<UuidString>(),
		// Privilege — DAV namespaced string, e.g. 'DAV:read', 'CALDAV:read-free-busy'
		privilege: text().notNull(),
		// Grant or deny (deny reserved for server-generated ACEs when grant-only is lifted)
		grantDeny: text("grant_deny").notNull().default("grant"),
		// Server-generated ACEs cannot be removed via the ACL method
		protected: boolean().notNull().default(false),
		// Evaluation order within a resource's ACL
		ordinal: integer().notNull().default(0),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
	},
	(table) => [
		// Fast privilege check: given principal(s) + resource, does a grant exist?
		index("idx_dav_acl_resource_principal").using(
			"btree",
			table.resourceId.asc().nullsLast(),
			table.principalId.asc().nullsLast(),
			table.privilege.asc().nullsLast(),
		),
		// PROPFIND DAV:acl: all ACEs for a resource, in evaluation order
		index("idx_dav_acl_resource_ordinal").using(
			"btree",
			table.resourceId.asc().nullsLast(),
			table.ordinal.asc().nullsLast(),
		),
		// Pseudo-principal lookups ('all', 'authenticated', etc.)
		index("idx_dav_acl_resource_principal_type").using(
			"btree",
			table.resourceId.asc().nullsLast(),
			table.principalType.asc().nullsLast(),
		),
		check(
			"dav_acl_grant_deny_check",
			sql`(grant_deny = ANY (ARRAY['grant'::text, 'deny'::text]))`,
		),
		check(
			"dav_acl_principal_type_check",
			sql`(principal_type = ANY (ARRAY['principal'::text, 'all'::text, 'authenticated'::text, 'unauthenticated'::text, 'self'::text]))`,
		),
		check(
			"dav_acl_resource_type_check",
			sql`(resource_type = ANY (ARRAY['collection'::text, 'instance'::text, 'principal'::text]))`,
		),
		check(
			"dav_acl_principal_id_required",
			sql`(principal_type <> 'principal'::text OR principal_id IS NOT NULL)`,
		),
	],
);
