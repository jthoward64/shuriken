import { pgTable, uuid, text, timestamp, boolean, jsonb, customType, index, check, primaryKey, unique } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { davEntity } from "./dav"
import { davComponent } from "./dav"

export const calTimezone = pgTable("cal_timezone", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	tzid: text().notNull(),
	vtimezoneData: text("vtimezone_data").notNull(),
	ianaName: text("iana_name"),
	createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
}, (table) => [
	index("idx_cal_timezone_tzid").using("btree", table.tzid.asc().nullsLast()),
	unique("cal_timezone_tzid_key").on(table.tzid),
]);

export const calIndex = pgTable("cal_index", {
	entityId: uuid("entity_id").notNull().references(() => davEntity.id, { onDelete: "cascade" }),
	componentId: uuid("component_id").notNull().references(() => davComponent.id, { onDelete: "cascade" }),
	componentType: text("component_type").notNull(),
	uid: text(),
	recurrenceIdUtc: timestamp("recurrence_id_utc", { withTimezone: true }),
	dtstartUtc: timestamp("dtstart_utc", { withTimezone: true }),
	dtendUtc: timestamp("dtend_utc", { withTimezone: true }),
	allDay: boolean("all_day"),
	rruleText: text("rrule_text"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	metadata: jsonb().default({}),
	searchTsv: customType({ dataType: () => 'tsvector' })("search_tsv").generatedAlwaysAs(sql`to_tsvector('english'::regconfig, ((((COALESCE((metadata ->> 'summary'::text), ''::text) || ' '::text) || COALESCE((metadata ->> 'location'::text), ''::text)) || ' '::text) || COALESCE((metadata ->> 'description'::text), ''::text)))`),
	metadataAsciiFold: jsonb("metadata_ascii_fold").generatedAlwaysAs(sql`jsonb_ascii_casemap(metadata)`),
	metadataUnicodeFold: jsonb("metadata_unicode_fold").generatedAlwaysAs(sql`jsonb_unicode_casemap_nfc(metadata)`),
}, (table) => [
	primaryKey({ columns: [table.entityId, table.componentId], name: "cal_index_pkey" }),
	index("idx_cal_index_component_active").using("btree", table.componentId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	index("idx_cal_index_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_cal_index_dtend").using("btree", table.dtendUtc.asc().nullsLast()),
	index("idx_cal_index_dtstart").using("btree", table.dtstartUtc.asc().nullsLast()),
	index("idx_cal_index_metadata").using("gin", table.metadata.asc().nullsLast()),
	index("idx_cal_index_search_tsv").using("gin", table.searchTsv.asc().nullsLast()),
	index("idx_cal_index_timerange").using("btree", table.dtstartUtc.asc().nullsLast(), table.dtendUtc.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	index("idx_cal_index_uid").using("btree", table.uid.asc().nullsLast()),
	index("idx_cal_index_uid_active").using("btree", table.uid.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (uid IS NOT NULL))`),
	check("chk_cal_index_component_type", sql`(component_type = ANY (ARRAY['VEVENT'::text, 'VTODO'::text, 'VJOURNAL'::text, 'VFREEBUSY'::text]))`),
]);
