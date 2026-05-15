import { sql } from "drizzle-orm";
import {
	index,
	pgTable,
	text,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { principal } from "./principal";
import { timestampTz } from "./types";

export const user = pgTable(
	"user",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		email: text().notNull(),
		/**
		 * Free-form role identifier. The set of recognised roles lives in
		 * `src/services/role/policy.ts`; storing as text means future roles
		 * (billing-admin, support, …) don't require a schema migration. Any
		 * unknown value behaves as `normal`.
		 */
		role: text().notNull().default("normal"),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
		principalId: uuid("principal_id")
			.notNull()
			.references(() => principal.id, { onDelete: "restrict" })
			.$type<UuidString>(),
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
	],
);
