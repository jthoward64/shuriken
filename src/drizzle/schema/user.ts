import { sql } from "drizzle-orm";
import {
	index,
	pgTable,
	text,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { principal } from "./principal";
import { timestampTz } from "./types";

export const user = pgTable(
	"user",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey(),
		name: text().notNull(),
		email: text().notNull(),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
		principalId: uuid("principal_id")
			.notNull()
			.references(() => principal.id, { onDelete: "restrict" }),
	},
	(table) => [
		index("idx_user_email_active").using(
			"btree",
			table.email.asc().nullsLast(),
		),
		index("idx_user_principal").using(
			"btree",
			table.principalId.asc().nullsLast(),
		),
		uniqueIndex("uq_user_principal_id").using(
			"btree",
			table.principalId.asc().nullsLast(),
		),
		unique("user_email_key").on(table.email),
		unique("user_email_unique").on(table.email),
	],
);
