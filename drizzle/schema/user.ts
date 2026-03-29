import { pgTable, uuid, text, timestamp, index, uniqueIndex, unique } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { principal } from "./principal"

export const user = pgTable("user", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	name: text().notNull(),
	email: text().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	principalId: uuid("principal_id").notNull().references(() => principal.id, { onDelete: "restrict" }),
}, (table) => [
	index("idx_user_email_active").using("btree", table.email.asc().nullsLast()),
	index("idx_user_principal").using("btree", table.principalId.asc().nullsLast()),
	uniqueIndex("uq_user_principal_id").using("btree", table.principalId.asc().nullsLast()),
	unique("user_email_key").on(table.email),
	unique("user_email_unique").on(table.email),
]);
