import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	jsonb,
	pgTable,
	primaryKey,
	smallint,
	text,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { davComponent, davEntity } from "./dav";
import {
	drizzleEnum,
	type GetDrizzleEnumType,
	timestampTz,
	tsvector,
} from "./types";

const componentTypeEnum = drizzleEnum(
	"component_type",
	["VEVENT", "VTODO", "VJOURNAL", "VFREEBUSY"] as const,
	"text",
);
export type ComponentType = GetDrizzleEnumType<typeof componentTypeEnum>;

export const calTimezone = pgTable(
	"cal_timezone",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		tzid: text().notNull(),
		vtimezoneData: text("vtimezone_data").notNull(),
		ianaName: text("iana_name"),
		lastModifiedAt: timestampTz("last_modified_at"),
		createdAt: timestampTz("created_at").default(sql`now()`).notNull(),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
	},
	(table) => [
		index("idx_cal_timezone_tzid").using("btree", table.tzid.asc().nullsLast()),
		unique("cal_timezone_tzid_key").on(table.tzid),
	],
);

export const calIndex = pgTable(
	"cal_index",
	{
		entityId: uuid("entity_id")
			.notNull()
			.references(() => davEntity.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		componentId: uuid("component_id")
			.notNull()
			.references(() => davComponent.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		componentType: text("component_type").notNull().$type<ComponentType>(),
		uid: text(),
		recurrenceIdUtc: timestampTz("recurrence_id_utc"),
		dtstartUtc: timestampTz("dtstart_utc"),
		dtendUtc: timestampTz("dtend_utc"),
		allDay: boolean("all_day"),
		rruleText: text("rrule_text"),
		// RRULE shape fields — used for SQL week-bucket pre-filtering.
		// rruleUntilUtc, rruleFreq, rruleInterval: extracted in the PG trigger via regex.
		// rruleOccurrenceMonths, rruleOccurrenceDayMin, rruleOccurrenceDayMax:
		// precomputed by TypeScript (rrule-temporal) after save and written via
		// CalIndexRepository.indexRruleOccurrences().
		rruleUntilUtc: timestampTz("rrule_until_utc"),
		rruleFreq: text("rrule_freq"),
		rruleInterval: smallint("rrule_interval"),
		rruleOccurrenceMonths: smallint("rrule_occurrence_months").array(),
		rruleOccurrenceDayMin: smallint("rrule_occurrence_day_min"),
		rruleOccurrenceDayMax: smallint("rrule_occurrence_day_max"),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
		deletedAt: timestampTz("deleted_at"),
		metadata: jsonb().default({}),
		searchTsv: tsvector("search_tsv").generatedAlwaysAs(
			sql`to_tsvector('english'::regconfig, ((((COALESCE((metadata ->> 'summary'::text), ''::text) || ' '::text) || COALESCE((metadata ->> 'location'::text), ''::text)) || ' '::text) || COALESCE((metadata ->> 'description'::text), ''::text)))`,
		),
		metadataAsciiFold: jsonb("metadata_ascii_fold").generatedAlwaysAs(
			sql`jsonb_ascii_casemap(metadata)`,
		),
		metadataUnicodeFold: jsonb("metadata_unicode_fold").generatedAlwaysAs(
			sql`jsonb_unicode_casemap_nfc(metadata)`,
		),
	},
	(table) => [
		primaryKey({
			columns: [table.entityId, table.componentId],
			name: "cal_index_pkey",
		}),
		index("idx_cal_index_component_active")
			.using("btree", table.componentId.asc().nullsLast())
			.where(sql`(deleted_at IS NULL)`),
		index("idx_cal_index_deleted_at").using(
			"btree",
			table.deletedAt.asc().nullsLast(),
		),
		index("idx_cal_index_dtend").using(
			"btree",
			table.dtendUtc.asc().nullsLast(),
		),
		index("idx_cal_index_dtstart").using(
			"btree",
			table.dtstartUtc.asc().nullsLast(),
		),
		index("idx_cal_index_metadata").using(
			"gin",
			table.metadata.asc().nullsLast(),
		),
		index("idx_cal_index_search_tsv").using(
			"gin",
			table.searchTsv.asc().nullsLast(),
		),
		index("idx_cal_index_timerange")
			.using(
				"btree",
				table.dtstartUtc.asc().nullsLast(),
				table.dtendUtc.asc().nullsLast(),
			)
			.where(sql`(deleted_at IS NULL)`),
		index("idx_cal_index_uid").using("btree", table.uid.asc().nullsLast()),
		index("idx_cal_index_uid_active")
			.using("btree", table.uid.asc().nullsLast())
			.where(sql`((deleted_at IS NULL) AND (uid IS NOT NULL))`),
		check("chk_cal_index_component_type", componentTypeEnum.sql),
	],
);
