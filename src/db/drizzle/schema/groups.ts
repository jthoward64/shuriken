import { sql } from "drizzle-orm";
import {
	index,
	pgTable,
	primaryKey,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { principal } from "./principal";
import { timestampTz } from "./types";
import { user } from "./user";

export const group = pgTable(
	"group",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey(),
		principalId: uuid("principal_id")
			.notNull()
			.references(() => principal.id, { onDelete: "restrict" }),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
	},
	(table) => [
		index("idx_group_principal").using(
			"btree",
			table.principalId.asc().nullsLast(),
		),
		uniqueIndex("uq_group_principal_id").using(
			"btree",
			table.principalId.asc().nullsLast(),
		),
	],
);

export const membership = pgTable(
	"membership",
	{
		userId: uuid("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		groupId: uuid("group_id")
			.notNull()
			.references(() => group.id, { onDelete: "cascade" }),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.userId, table.groupId],
			name: "membership_pkey",
		}),
		index("idx_membership_group_id").using(
			"btree",
			table.groupId.asc().nullsLast(),
		),
		index("idx_membership_user_id").using(
			"btree",
			table.userId.asc().nullsLast(),
		),
	],
);
