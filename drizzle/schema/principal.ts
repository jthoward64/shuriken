import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const principal = pgTable("principal", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	principalType: text("principal_type").notNull(),
	displayName: text("display_name"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	slug: text().default("").notNull(),
}, (table) => [
	index("idx_principal_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_principal_principal_type").using("btree", table.principalType.asc().nullsLast()),
	index("idx_principal_type_active").using("btree", table.principalType.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	uniqueIndex("unique_principal_slug_per_type").using("btree", table.principalType.asc().nullsLast(), table.slug.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	check("principal_principal_type_check", sql`(principal_type = ANY (ARRAY['user'::text, 'group'::text, 'system'::text, 'public'::text, 'resource'::text]))`),
]);
