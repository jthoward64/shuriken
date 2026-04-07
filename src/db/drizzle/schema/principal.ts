import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgTable,
	text,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { timestampTz } from "./types";

export const principal = pgTable(
	"principal",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		principalType: text("principal_type").notNull(),
		displayName: text("display_name"),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
		deletedAt: timestampTz("deleted_at"),
		slug: text().default("").notNull(),
	},
	(table) => [
		index("idx_principal_deleted_at").using(
			"btree",
			table.deletedAt.asc().nullsLast(),
		),
		index("idx_principal_principal_type").using(
			"btree",
			table.principalType.asc().nullsLast(),
		),
		index("idx_principal_type_active")
			.using("btree", table.principalType.asc().nullsLast())
			.where(sql`(deleted_at IS NULL)`),
		uniqueIndex("unique_principal_slug_per_type")
			.using(
				"btree",
				table.principalType.asc().nullsLast(),
				table.slug.asc().nullsLast(),
			)
			.where(sql`(deleted_at IS NULL)`),
		check(
			"principal_principal_type_check",
			sql`(principal_type = ANY (ARRAY['user'::text, 'group'::text, 'system'::text, 'public'::text, 'resource'::text]))`,
		),
	],
);
