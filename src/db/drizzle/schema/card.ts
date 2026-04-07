import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { davEntity } from "./dav";
import { timestampTz, tsvector } from "./types";

export const cardIndex = pgTable(
	"card_index",
	{
		entityId: uuid("entity_id")
			.primaryKey()
			.references(() => davEntity.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		uid: text(),
		fn: text(),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
		deletedAt: timestampTz("deleted_at"),
		data: jsonb().default({}),
		searchTsv: tsvector("search_tsv"),
		fnAsciiFold:
			text("fn_ascii_fold").generatedAlwaysAs(sql`ascii_casemap(fn)`),
		fnUnicodeFold: text("fn_unicode_fold").generatedAlwaysAs(
			sql`unicode_casemap_nfc(fn)`,
		),
		dataAsciiFold: jsonb("data_ascii_fold").generatedAlwaysAs(
			sql`jsonb_ascii_casemap(data)`,
		),
		dataUnicodeFold: jsonb("data_unicode_fold").generatedAlwaysAs(
			sql`jsonb_unicode_casemap_nfc(data)`,
		),
	},
	(table) => [
		index("idx_card_index_data").using("gin", table.data.asc().nullsLast()),
		index("idx_card_index_deleted_at").using(
			"btree",
			table.deletedAt.asc().nullsLast(),
		),
		index("idx_card_index_search_tsv").using(
			"gin",
			table.searchTsv.asc().nullsLast(),
		),
		index("idx_card_index_uid").using("btree", table.uid.asc().nullsLast()),
		index("idx_card_index_uid_active")
			.using("btree", table.uid.asc().nullsLast())
			.where(sql`((deleted_at IS NULL) AND (uid IS NOT NULL))`),
	],
);
