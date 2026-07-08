import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgTable,
	primaryKey,
	text,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { principal } from "./principal.ts";
import { drizzleEnum, type GetDrizzleEnumType, timestampTz } from "./types.ts";
import { user } from "./user.ts";

const autoAssignedByEnum = drizzleEnum(
	"auto_assigned_by",
	["oidc"] as const,
	"text",
);
export type AutoAssignedBySource = GetDrizzleEnumType<
	typeof autoAssignedByEnum
>;

export const group = pgTable(
	"group",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		principalId: uuid("principal_id")
			.notNull()
			.references(() => principal.id, { onDelete: "restrict" })
			.$type<UuidString>(),
		// IdP group names (from OIDC_GROUPS_CLAIM) that auto-assign membership.
		oidcGroups: text("oidc_groups").array().default([]).notNull(),
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
			.references(() => user.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		groupId: uuid("group_id")
			.notNull()
			.references(() => group.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		// null = manually assigned by an admin; otherwise the automated source
		// that created this membership (e.g. "oidc" group-claim sync).
		autoAssignedBy: text("auto_assigned_by").$type<AutoAssignedBySource>(),
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
		check("membership_auto_assigned_by_check", autoAssignedByEnum.sql),
	],
);
