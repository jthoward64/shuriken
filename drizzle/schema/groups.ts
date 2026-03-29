import { pgTable, uuid, text, timestamp, index, uniqueIndex, unique, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { principal } from "./principal"
import { user } from "./user"

export const group = pgTable("group", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	primaryName: uuid("primary_name").references((): AnyPgColumn => groupName.id, { onDelete: "set null" }),
	principalId: uuid("principal_id").notNull().references(() => principal.id, { onDelete: "restrict" }),
}, (table) => [
	index("idx_group_principal").using("btree", table.principalId.asc().nullsLast()),
	uniqueIndex("uq_group_principal_id").using("btree", table.principalId.asc().nullsLast()),
]);

export const groupName = pgTable("group_name", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	groupId: uuid("group_id").notNull().references((): AnyPgColumn => group.id, { onDelete: "cascade" }),
	name: text().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
}, (table) => [
	index("idx_group_name_group_id").using("btree", table.groupId.asc().nullsLast()),
	index("idx_group_name_name").using("btree", table.name.asc().nullsLast()),
	unique("group_name_name_key").on(table.name),
]);

export const membership = pgTable("membership", {
	userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	groupId: uuid("group_id").notNull().references(() => group.id, { onDelete: "cascade" }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
}, (table) => [
	primaryKey({ columns: [table.userId, table.groupId], name: "membership_pkey" }),
	index("idx_membership_group_id").using("btree", table.groupId.asc().nullsLast()),
	index("idx_membership_user_id").using("btree", table.userId.asc().nullsLast()),
]);
