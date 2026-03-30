import { sql } from "drizzle-orm";
import { index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestampTz } from "./types";
import { user } from "./user";

export const authUser = pgTable(
	"auth_user",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey(),
		userId: uuid("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		authSource: text("auth_source").notNull(),
		authId: text("auth_id").notNull(),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
		authCredential: text("auth_credential"),
	},
	(table) => [
		index("idx_auth_user_auth_source_auth_id").using(
			"btree",
			table.authSource.asc().nullsLast(),
			table.authId.asc().nullsLast(),
		),
		index("idx_auth_user_user_id").using(
			"btree",
			table.userId.asc().nullsLast(),
		),
		unique("auth_user_auth_source_auth_id_key").on(
			table.authSource,
			table.authId,
		),
		unique("auth_user_auth_source_auth_id_unique").on(
			table.authSource,
			table.authId,
		),
	],
);
