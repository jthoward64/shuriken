import { pgTable, integer, varchar, index } from "drizzle-orm/pg-core"

export const casbinRule = pgTable("casbin_rule", {
	id: integer().primaryKey().generatedAlwaysAsIdentity(),
	ptype: varchar().notNull(),
	v0: varchar().default("").notNull(),
	v1: varchar().default("").notNull(),
	v2: varchar().default("").notNull(),
	v3: varchar().default("").notNull(),
	v4: varchar().default("").notNull(),
	v5: varchar().default("").notNull(),
}, (table) => [
	index("idx_casbin_rule_ptype").using("btree", table.ptype.asc().nullsLast()),
	index("idx_casbin_rule_v0").using("btree", table.v0.asc().nullsLast()),
	index("idx_casbin_rule_v1").using("btree", table.v1.asc().nullsLast()),
	index("idx_casbin_rule_v2").using("btree", table.v2.asc().nullsLast()),
]);
