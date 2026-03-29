import { pgTable, uuid, text, timestamp, jsonb, customType, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { davEntity } from "./dav"

export const cardIndex = pgTable("card_index", {
	entityId: uuid("entity_id").primaryKey().references(() => davEntity.id, { onDelete: "cascade" }),
	uid: text(),
	fn: text(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	data: jsonb().default({}),
	searchTsv: customType({ dataType: () => 'tsvector' })("search_tsv"),
	fnAsciiFold: text("fn_ascii_fold").generatedAlwaysAs(sql`ascii_casemap(fn)`),
	fnUnicodeFold: text("fn_unicode_fold").generatedAlwaysAs(sql`unicode_casemap_nfc(fn)`),
	dataAsciiFold: jsonb("data_ascii_fold").generatedAlwaysAs(sql`jsonb_ascii_casemap(data)`),
	dataUnicodeFold: jsonb("data_unicode_fold").generatedAlwaysAs(sql`jsonb_unicode_casemap_nfc(data)`),
}, (table) => [
	index("idx_card_index_data").using("gin", table.data.asc().nullsLast()),
	index("idx_card_index_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_card_index_search_tsv").using("gin", table.searchTsv.asc().nullsLast()),
	index("idx_card_index_uid").using("btree", table.uid.asc().nullsLast()),
	index("idx_card_index_uid_active").using("btree", table.uid.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (uid IS NOT NULL))`),
]);
