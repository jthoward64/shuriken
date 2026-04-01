import { index, integer, pgTable, text } from "drizzle-orm/pg-core";

export const casbinRule = pgTable(
	"casbin_rule",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		ptype: text("ptype"),
		v0: text("v0"),
		v1: text("v1"),
		v2: text("v2"),
		v3: text("v3"),
		v4: text("v4"),
		v5: text("v5"),
	},
	(table) => [
		index("idx_casbin_rule_ptype").using(
			"btree",
			table.ptype.asc().nullsLast(),
		),
		index("idx_casbin_rule_v0").using("btree", table.v0.asc().nullsLast()),
		index("idx_casbin_rule_v1").using("btree", table.v1.asc().nullsLast()),
		index("idx_casbin_rule_v2").using("btree", table.v2.asc().nullsLast()),
	],
);
