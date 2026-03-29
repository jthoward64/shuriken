import { pgTable, uuid, text, timestamp, bigint, customType, doublePrecision, jsonb, boolean, date, time, interval, integer, index, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { principal } from "./principal"

export const davEntity = pgTable("dav_entity", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	entityType: text("entity_type").notNull(),
	logicalUid: text("logical_uid"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
	index("idx_dav_entity_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_dav_entity_logical_uid").using("btree", table.logicalUid.asc().nullsLast()),
	index("idx_dav_entity_logical_uid_active").using("btree", table.logicalUid.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (logical_uid IS NOT NULL))`),
	index("idx_dav_entity_type").using("btree", table.entityType.asc().nullsLast()),
	check("dav_entity_entity_type_check", sql`(entity_type = ANY (ARRAY['icalendar'::text, 'vcard'::text]))`),
]);

export const davCollection = pgTable("dav_collection", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	ownerPrincipalId: uuid("owner_principal_id").notNull().references(() => principal.id, { onDelete: "restrict" }),
	collectionType: text("collection_type").notNull(),
	displayName: text("display_name"),
	description: text(),
	timezoneTzid: text("timezone_tzid"),
	synctoken: bigint({ mode: 'number' }).default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	supportedComponents: text("supported_components").array(),
	slug: text().default("").notNull(),
	parentCollectionId: uuid("parent_collection_id"),
}, (table) => [
	foreignKey({
		columns: [table.parentCollectionId],
		foreignColumns: [table.id],
		name: "dav_collection_parent_collection_id_fkey"
	}).onDelete("cascade"),
	index("idx_dav_collection_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_dav_collection_owner").using("btree", table.ownerPrincipalId.asc().nullsLast()),
	index("idx_dav_collection_owner_active").using("btree", table.ownerPrincipalId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	index("idx_dav_collection_type_active").using("btree", table.collectionType.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	uniqueIndex("unique_collection_slug_per_owner").using("btree", table.ownerPrincipalId.asc().nullsLast(), table.slug.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	check("dav_collection_collection_type_check", sql`(collection_type = ANY (ARRAY['collection'::text, 'calendar'::text, 'addressbook'::text]))`),
]);

export const davComponent = pgTable("dav_component", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	entityId: uuid("entity_id").notNull().references(() => davEntity.id, { onDelete: "cascade" }),
	parentComponentId: uuid("parent_component_id"),
	name: text().notNull(),
	ordinal: integer().default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
	foreignKey({
		columns: [table.parentComponentId],
		foreignColumns: [table.id],
		name: "dav_component_parent_component_id_fkey"
	}).onDelete("cascade"),
	index("idx_dav_component_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_dav_component_entity").using("btree", table.entityId.asc().nullsLast()),
	index("idx_dav_component_parent").using("btree", table.parentComponentId.asc().nullsLast()),
]);

export const davProperty = pgTable("dav_property", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	componentId: uuid("component_id").notNull().references(() => davComponent.id, { onDelete: "cascade" }),
	name: text().notNull(),
	valueType: text("value_type").notNull(),
	valueText: text("value_text"),
	valueInt: bigint("value_int", { mode: 'number' }),
	valueFloat: doublePrecision("value_float"),
	valueBool: boolean("value_bool"),
	valueDate: date("value_date"),
	valueTstz: timestamp("value_tstz", { withTimezone: true }),
	valueBytes: customType({ dataType: () => 'bytea' })("value_bytes"),
	valueJson: jsonb("value_json"),
	ordinal: integer().default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	groupName: text("group_name"),
	valueTextArray: text("value_text_array").array(),
	valueDateArray: date("value_date_array").array(),
	valueTstzArray: timestamp("value_tstz_array", { withTimezone: true }).array(),
	valueTime: time("value_time"),
	valueInterval: interval("value_interval"),
	valueTstzrange: customType({ dataType: () => 'tstzrange' })("value_tstzrange"),
	valueTextAsciiFold: text("value_text_ascii_fold").generatedAlwaysAs(sql`ascii_casemap(value_text)`),
	valueTextUnicodeFold: text("value_text_unicode_fold").generatedAlwaysAs(sql`unicode_casemap_nfc(value_text)`),
}, (table) => [
	index("idx_dav_property_component").using("btree", table.componentId.asc().nullsLast()),
	index("idx_dav_property_component_name").using("btree", table.componentId.asc().nullsLast(), table.name.asc().nullsLast()),
	index("idx_dav_property_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_dav_property_name").using("btree", table.name.asc().nullsLast()),
	check("chk_dav_property_single_value", sql`((((((((((((((
CASE
    WHEN (value_text IS NOT NULL) THEN 1
    ELSE 0
END +
CASE
    WHEN (value_int IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_float IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_bool IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_date IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_tstz IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_bytes IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_json IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_text_array IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_date_array IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_tstz_array IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_time IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_interval IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_tstzrange IS NOT NULL) THEN 1
    ELSE 0
END) <= 1)`),
	check("chk_dav_property_value_matches_type", sql`(((value_text IS NULL) OR (value_type = ANY (ARRAY['TEXT'::text, 'DURATION'::text, 'URI'::text, 'UTC_OFFSET'::text]))) AND ((value_int IS NULL) OR (value_type = 'INTEGER'::text)) AND ((value_float IS NULL) OR (value_type = 'FLOAT'::text)) AND ((value_bool IS NULL) OR (value_type = 'BOOLEAN'::text)) AND ((value_date IS NULL) OR (value_type = 'DATE'::text)) AND ((value_tstz IS NULL) OR (value_type = 'DATE_TIME'::text)) AND ((value_bytes IS NULL) OR (value_type = 'BINARY'::text)) AND ((value_json IS NULL) OR (value_type = 'JSON'::text)) AND ((value_text_array IS NULL) OR (value_type = 'TEXT_LIST'::text)) AND ((value_date_array IS NULL) OR (value_type = 'DATE_LIST'::text)) AND ((value_tstz_array IS NULL) OR (value_type = 'DATE_TIME_LIST'::text)) AND ((value_time IS NULL) OR (value_type = 'TIME'::text)) AND ((value_interval IS NULL) OR (value_type = ANY (ARRAY['DURATION_INTERVAL'::text, 'UTC_OFFSET_INTERVAL'::text]))) AND ((value_tstzrange IS NULL) OR (value_type = ANY (ARRAY['PERIOD'::text, 'PERIOD_LIST'::text]))))`),
	check("dav_property_value_type_check", sql`(value_type = ANY (ARRAY['TEXT'::text, 'INTEGER'::text, 'FLOAT'::text, 'BOOLEAN'::text, 'DATE'::text, 'DATE_TIME'::text, 'DURATION'::text, 'URI'::text, 'BINARY'::text, 'JSON'::text, 'TEXT_LIST'::text, 'DATE_LIST'::text, 'DATE_TIME_LIST'::text, 'TIME'::text, 'DURATION_INTERVAL'::text, 'UTC_OFFSET'::text, 'UTC_OFFSET_INTERVAL'::text, 'PERIOD'::text, 'PERIOD_LIST'::text]))`),
]);

export const davParameter = pgTable("dav_parameter", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	propertyId: uuid("property_id").notNull().references(() => davProperty.id, { onDelete: "cascade" }),
	name: text().notNull(),
	value: text().notNull(),
	ordinal: integer().default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
	index("idx_dav_parameter_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_dav_parameter_name").using("btree", table.name.asc().nullsLast()),
	index("idx_dav_parameter_property").using("btree", table.propertyId.asc().nullsLast()),
	index("idx_dav_parameter_property_name").using("btree", table.propertyId.asc().nullsLast(), table.name.asc().nullsLast()),
]);

export const davInstance = pgTable("dav_instance", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	collectionId: uuid("collection_id").notNull().references(() => davCollection.id, { onDelete: "restrict" }),
	entityId: uuid("entity_id").notNull().references(() => davEntity.id, { onDelete: "restrict" }),
	contentType: text("content_type").notNull(),
	etag: text().notNull(),
	syncRevision: bigint("sync_revision", { mode: 'number' }).default(0).notNull(),
	lastModified: timestamp("last_modified", { withTimezone: true }).default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	scheduleTag: text("schedule_tag"),
	slug: text().default("").notNull(),
}, (table) => [
	index("idx_dav_instance_collection").using("btree", table.collectionId.asc().nullsLast()),
	index("idx_dav_instance_collection_active").using("btree", table.collectionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	index("idx_dav_instance_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_dav_instance_entity").using("btree", table.entityId.asc().nullsLast()),
	index("idx_dav_instance_sync_query").using("btree", table.collectionId.asc().nullsLast(), table.syncRevision.asc().nullsLast(), table.deletedAt.asc().nullsLast()),
	index("idx_dav_instance_sync_revision").using("btree", table.collectionId.asc().nullsLast(), table.syncRevision.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	uniqueIndex("unique_instance_slug_per_collection").using("btree", table.collectionId.asc().nullsLast(), table.slug.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	check("dav_instance_content_type_check", sql`(content_type = ANY (ARRAY['text/calendar'::text, 'text/vcard'::text]))`),
]);

export const davScheduleMessage = pgTable("dav_schedule_message", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	collectionId: uuid("collection_id").notNull().references(() => davCollection.id, { onDelete: "cascade" }),
	sender: text().notNull(),
	recipient: text().notNull(),
	method: text().notNull(),
	status: text().default("pending").notNull(),
	icalData: text("ical_data").notNull(),
	diagnostics: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deliveredAt: timestamp("delivered_at", { withTimezone: true }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
	index("idx_dav_schedule_message_collection").using("btree", table.collectionId.asc().nullsLast()),
	index("idx_dav_schedule_message_created").using("btree", table.createdAt.asc().nullsLast()),
	index("idx_dav_schedule_message_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_dav_schedule_message_recipient").using("btree", table.recipient.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	index("idx_dav_schedule_message_status").using("btree", table.status.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
	check("dav_schedule_message_method_check", sql`(method = ANY (ARRAY['REQUEST'::text, 'REPLY'::text, 'CANCEL'::text, 'REFRESH'::text, 'COUNTER'::text, 'DECLINECOUNTER'::text, 'ADD'::text]))`),
	check("dav_schedule_message_status_check", sql`(status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text]))`),
]);

export const davShadow = pgTable("dav_shadow", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	instanceId: uuid("instance_id").references(() => davInstance.id, { onDelete: "cascade" }),
	entityId: uuid("entity_id").references(() => davEntity.id, { onDelete: "cascade" }),
	direction: text().notNull(),
	contentType: text("content_type").notNull(),
	rawOriginal: customType({ dataType: () => 'bytea' })("raw_original"),
	rawCanonical: customType({ dataType: () => 'bytea' })("raw_canonical"),
	diagnostics: jsonb(),
	requestId: text("request_id"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
	index("idx_dav_shadow_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_dav_shadow_entity").using("btree", table.entityId.asc().nullsLast()),
	index("idx_dav_shadow_instance").using("btree", table.instanceId.asc().nullsLast()),
	index("idx_dav_shadow_request_id").using("btree", table.requestId.asc().nullsLast()),
	check("chk_dav_shadow_ref", sql`((instance_id IS NOT NULL) OR (entity_id IS NOT NULL))`),
	check("dav_shadow_content_type_check", sql`(content_type = ANY (ARRAY['text/calendar'::text, 'text/vcard'::text]))`),
	check("dav_shadow_direction_check", sql`(direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))`),
]);

export const davTombstone = pgTable("dav_tombstone", {
	id: uuid().default(sql`uuidv7()`).primaryKey(),
	collectionId: uuid("collection_id").notNull().references(() => davCollection.id, { onDelete: "restrict" }),
	entityId: uuid("entity_id").references(() => davEntity.id, { onDelete: "set null" }),
	synctoken: bigint({ mode: 'number' }).notNull(),
	syncRevision: bigint("sync_revision", { mode: 'number' }).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }).default(sql`now()`).notNull(),
	lastEtag: text("last_etag"),
	logicalUid: text("logical_uid"),
	uriVariants: text("uri_variants").array().notNull(),
}, (table) => [
	index("idx_dav_tombstone_collection").using("btree", table.collectionId.asc().nullsLast()),
	index("idx_dav_tombstone_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
]);
