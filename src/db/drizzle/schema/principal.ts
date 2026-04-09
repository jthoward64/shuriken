import { sql } from "drizzle-orm";
import {
	check,
	index,
	jsonb,
	pgTable,
	text,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { drizzleEnum, type GetDrizzleEnumType, timestampTz } from "./types";

const principalTypeEnum = drizzleEnum(
	"principal_type",
	["user", "group", "system", "public", "resource"] as const,
	"text",
);
export type PrincipalKind = GetDrizzleEnumType<typeof principalTypeEnum>;

export const principal = pgTable(
	"principal",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		principalType: text("principal_type").notNull().$type<PrincipalKind>(),
		displayName: text("display_name"),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
		deletedAt: timestampTz("deleted_at"),
		slug: text().default("").notNull(),
		// RFC 4918 §4.1 dead properties — stored as Clark-notation keyed JSONB object.
		clientProperties: jsonb("client_properties").default({}).notNull(),
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
		check("principal_principal_type_check", principalTypeEnum.sql),
	],
);
