-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations

CREATE TABLE "__diesel_schema_migrations" (
	"version" varchar(50) PRIMARY KEY,
	"run_on" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"auth_source" text NOT NULL,
	"auth_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"auth_credential" text,
	CONSTRAINT "auth_user_auth_source_auth_id_key" UNIQUE("auth_source","auth_id"),
	CONSTRAINT "auth_user_auth_source_auth_id_unique" UNIQUE("auth_source","auth_id")
);
--> statement-breakpoint
CREATE TABLE "cal_index" (
	"entity_id" uuid,
	"component_id" uuid,
	"component_type" text NOT NULL,
	"uid" text,
	"recurrence_id_utc" timestamp with time zone,
	"dtstart_utc" timestamp with time zone,
	"dtend_utc" timestamp with time zone,
	"all_day" boolean,
	"rrule_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}',
	"search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, ((((COALESCE((metadata ->> 'summary'::text), ''::text) || ' '::text) || COALESCE((metadata ->> 'location'::text), ''::text)) || ' '::text) || COALESCE((metadata ->> 'description'::text), ''::text)))) STORED,
	"metadata_ascii_fold" jsonb GENERATED ALWAYS AS (jsonb_ascii_casemap(metadata)) STORED,
	"metadata_unicode_fold" jsonb GENERATED ALWAYS AS (jsonb_unicode_casemap_nfc(metadata)) STORED,
	CONSTRAINT "cal_index_pkey" PRIMARY KEY("entity_id","component_id"),
	CONSTRAINT "chk_cal_index_component_type" CHECK ((component_type = ANY (ARRAY['VEVENT'::text, 'VTODO'::text, 'VJOURNAL'::text, 'VFREEBUSY'::text])))
);
--> statement-breakpoint
CREATE TABLE "cal_timezone" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tzid" text NOT NULL CONSTRAINT "cal_timezone_tzid_key" UNIQUE,
	"vtimezone_data" text NOT NULL,
	"iana_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_index" (
	"entity_id" uuid PRIMARY KEY,
	"uid" text,
	"fn" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"data" jsonb DEFAULT '{}',
	"search_tsv" tsvector,
	"fn_ascii_fold" text GENERATED ALWAYS AS (ascii_casemap(fn)) STORED,
	"fn_unicode_fold" text GENERATED ALWAYS AS (unicode_casemap_nfc(fn)) STORED,
	"data_ascii_fold" jsonb GENERATED ALWAYS AS (jsonb_ascii_casemap(data)) STORED,
	"data_unicode_fold" jsonb GENERATED ALWAYS AS (jsonb_unicode_casemap_nfc(data)) STORED
);
--> statement-breakpoint
CREATE TABLE "casbin_rule" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "casbin_rule_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ptype" varchar NOT NULL,
	"v0" varchar DEFAULT '' NOT NULL,
	"v1" varchar DEFAULT '' NOT NULL,
	"v2" varchar DEFAULT '' NOT NULL,
	"v3" varchar DEFAULT '' NOT NULL,
	"v4" varchar DEFAULT '' NOT NULL,
	"v5" varchar DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dav_collection" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_principal_id" uuid NOT NULL,
	"collection_type" text NOT NULL,
	"display_name" text,
	"description" text,
	"timezone_tzid" text,
	"synctoken" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"supported_components" text[],
	"slug" text DEFAULT '' NOT NULL,
	"parent_collection_id" uuid,
	CONSTRAINT "dav_collection_collection_type_check" CHECK ((collection_type = ANY (ARRAY['collection'::text, 'calendar'::text, 'addressbook'::text])))
);
--> statement-breakpoint
CREATE TABLE "dav_component" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"entity_id" uuid NOT NULL,
	"parent_component_id" uuid,
	"name" text NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dav_entity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"entity_type" text NOT NULL,
	"logical_uid" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dav_entity_entity_type_check" CHECK ((entity_type = ANY (ARRAY['icalendar'::text, 'vcard'::text])))
);
--> statement-breakpoint
CREATE TABLE "dav_instance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"collection_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"etag" text NOT NULL,
	"sync_revision" bigint DEFAULT 0 NOT NULL,
	"last_modified" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"schedule_tag" text,
	"slug" text DEFAULT '' NOT NULL,
	CONSTRAINT "dav_instance_content_type_check" CHECK ((content_type = ANY (ARRAY['text/calendar'::text, 'text/vcard'::text])))
);
--> statement-breakpoint
CREATE TABLE "dav_parameter" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dav_property" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"component_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value_type" text NOT NULL,
	"value_text" text,
	"value_int" bigint,
	"value_float" double precision,
	"value_bool" boolean,
	"value_date" date,
	"value_tstz" timestamp with time zone,
	"value_bytes" bytea,
	"value_json" jsonb,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"group_name" text,
	"value_text_array" text[],
	"value_date_array" date[],
	"value_tstz_array" timestamp with time zone[],
	"value_time" time,
	"value_interval" interval,
	"value_tstzrange" tstzrange,
	"value_text_ascii_fold" text GENERATED ALWAYS AS (ascii_casemap(value_text)) STORED,
	"value_text_unicode_fold" text GENERATED ALWAYS AS (unicode_casemap_nfc(value_text)) STORED,
	CONSTRAINT "chk_dav_property_single_value" CHECK (((((((((((((((
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
END) <= 1)),
	CONSTRAINT "chk_dav_property_value_matches_type" CHECK ((((value_text IS NULL) OR (value_type = ANY (ARRAY['TEXT'::text, 'DURATION'::text, 'URI'::text, 'UTC_OFFSET'::text]))) AND ((value_int IS NULL) OR (value_type = 'INTEGER'::text)) AND ((value_float IS NULL) OR (value_type = 'FLOAT'::text)) AND ((value_bool IS NULL) OR (value_type = 'BOOLEAN'::text)) AND ((value_date IS NULL) OR (value_type = 'DATE'::text)) AND ((value_tstz IS NULL) OR (value_type = 'DATE_TIME'::text)) AND ((value_bytes IS NULL) OR (value_type = 'BINARY'::text)) AND ((value_json IS NULL) OR (value_type = 'JSON'::text)) AND ((value_text_array IS NULL) OR (value_type = 'TEXT_LIST'::text)) AND ((value_date_array IS NULL) OR (value_type = 'DATE_LIST'::text)) AND ((value_tstz_array IS NULL) OR (value_type = 'DATE_TIME_LIST'::text)) AND ((value_time IS NULL) OR (value_type = 'TIME'::text)) AND ((value_interval IS NULL) OR (value_type = ANY (ARRAY['DURATION_INTERVAL'::text, 'UTC_OFFSET_INTERVAL'::text]))) AND ((value_tstzrange IS NULL) OR (value_type = ANY (ARRAY['PERIOD'::text, 'PERIOD_LIST'::text]))))),
	CONSTRAINT "dav_property_value_type_check" CHECK ((value_type = ANY (ARRAY['TEXT'::text, 'INTEGER'::text, 'FLOAT'::text, 'BOOLEAN'::text, 'DATE'::text, 'DATE_TIME'::text, 'DURATION'::text, 'URI'::text, 'BINARY'::text, 'JSON'::text, 'TEXT_LIST'::text, 'DATE_LIST'::text, 'DATE_TIME_LIST'::text, 'TIME'::text, 'DURATION_INTERVAL'::text, 'UTC_OFFSET'::text, 'UTC_OFFSET_INTERVAL'::text, 'PERIOD'::text, 'PERIOD_LIST'::text])))
);
--> statement-breakpoint
CREATE TABLE "dav_schedule_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"collection_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"recipient" text NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ical_data" text NOT NULL,
	"diagnostics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dav_schedule_message_method_check" CHECK ((method = ANY (ARRAY['REQUEST'::text, 'REPLY'::text, 'CANCEL'::text, 'REFRESH'::text, 'COUNTER'::text, 'DECLINECOUNTER'::text, 'ADD'::text]))),
	CONSTRAINT "dav_schedule_message_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text])))
);
--> statement-breakpoint
CREATE TABLE "dav_shadow" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"instance_id" uuid,
	"entity_id" uuid,
	"direction" text NOT NULL,
	"content_type" text NOT NULL,
	"raw_original" bytea,
	"raw_canonical" bytea,
	"diagnostics" jsonb,
	"request_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chk_dav_shadow_ref" CHECK (((instance_id IS NOT NULL) OR (entity_id IS NOT NULL))),
	CONSTRAINT "dav_shadow_content_type_check" CHECK ((content_type = ANY (ARRAY['text/calendar'::text, 'text/vcard'::text]))),
	CONSTRAINT "dav_shadow_direction_check" CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))
);
--> statement-breakpoint
CREATE TABLE "dav_tombstone" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"collection_id" uuid NOT NULL,
	"entity_id" uuid,
	"synctoken" bigint NOT NULL,
	"sync_revision" bigint NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_etag" text,
	"logical_uid" text,
	"uri_variants" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"primary_name" uuid,
	"principal_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_name" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"group_id" uuid NOT NULL,
	"name" text NOT NULL CONSTRAINT "group_name_name_key" UNIQUE,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"user_id" uuid,
	"group_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_pkey" PRIMARY KEY("user_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "principal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"principal_type" text NOT NULL,
	"display_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"slug" text DEFAULT '' NOT NULL,
	CONSTRAINT "principal_principal_type_check" CHECK ((principal_type = ANY (ARRAY['user'::text, 'group'::text, 'system'::text, 'public'::text, 'resource'::text])))
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"email" text NOT NULL CONSTRAINT "user_email_key" UNIQUE,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"principal_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_auth_user_auth_source_auth_id" ON "auth_user" ("auth_source","auth_id");--> statement-breakpoint
CREATE INDEX "idx_auth_user_user_id" ON "auth_user" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_cal_index_component_active" ON "cal_index" ("component_id") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_cal_index_deleted_at" ON "cal_index" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_cal_index_dtend" ON "cal_index" ("dtend_utc");--> statement-breakpoint
CREATE INDEX "idx_cal_index_dtstart" ON "cal_index" ("dtstart_utc");--> statement-breakpoint
CREATE INDEX "idx_cal_index_metadata" ON "cal_index" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_cal_index_search_tsv" ON "cal_index" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "idx_cal_index_timerange" ON "cal_index" ("dtstart_utc","dtend_utc") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_cal_index_uid" ON "cal_index" ("uid");--> statement-breakpoint
CREATE INDEX "idx_cal_index_uid_active" ON "cal_index" ("uid") WHERE ((deleted_at IS NULL) AND (uid IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_cal_timezone_tzid" ON "cal_timezone" ("tzid");--> statement-breakpoint
CREATE INDEX "idx_card_index_data" ON "card_index" USING gin ("data");--> statement-breakpoint
CREATE INDEX "idx_card_index_deleted_at" ON "card_index" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_card_index_search_tsv" ON "card_index" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "idx_card_index_uid" ON "card_index" ("uid");--> statement-breakpoint
CREATE INDEX "idx_card_index_uid_active" ON "card_index" ("uid") WHERE ((deleted_at IS NULL) AND (uid IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_casbin_rule_ptype" ON "casbin_rule" ("ptype");--> statement-breakpoint
CREATE INDEX "idx_casbin_rule_v0" ON "casbin_rule" ("v0");--> statement-breakpoint
CREATE INDEX "idx_casbin_rule_v1" ON "casbin_rule" ("v1");--> statement-breakpoint
CREATE INDEX "idx_casbin_rule_v2" ON "casbin_rule" ("v2");--> statement-breakpoint
CREATE INDEX "idx_dav_collection_deleted_at" ON "dav_collection" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_dav_collection_owner" ON "dav_collection" ("owner_principal_id");--> statement-breakpoint
CREATE INDEX "idx_dav_collection_owner_active" ON "dav_collection" ("owner_principal_id") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_dav_collection_type_active" ON "dav_collection" ("collection_type") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "unique_collection_slug_per_owner" ON "dav_collection" ("owner_principal_id","slug") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_dav_component_deleted_at" ON "dav_component" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_dav_component_entity" ON "dav_component" ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_dav_component_parent" ON "dav_component" ("parent_component_id");--> statement-breakpoint
CREATE INDEX "idx_dav_entity_deleted_at" ON "dav_entity" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_dav_entity_logical_uid" ON "dav_entity" ("logical_uid");--> statement-breakpoint
CREATE INDEX "idx_dav_entity_logical_uid_active" ON "dav_entity" ("logical_uid") WHERE ((deleted_at IS NULL) AND (logical_uid IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_dav_entity_type" ON "dav_entity" ("entity_type");--> statement-breakpoint
CREATE INDEX "idx_dav_instance_collection" ON "dav_instance" ("collection_id");--> statement-breakpoint
CREATE INDEX "idx_dav_instance_collection_active" ON "dav_instance" ("collection_id") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_dav_instance_deleted_at" ON "dav_instance" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_dav_instance_entity" ON "dav_instance" ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_dav_instance_sync_query" ON "dav_instance" ("collection_id","sync_revision","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_dav_instance_sync_revision" ON "dav_instance" ("collection_id","sync_revision") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "unique_instance_slug_per_collection" ON "dav_instance" ("collection_id","slug") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_dav_parameter_deleted_at" ON "dav_parameter" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_dav_parameter_name" ON "dav_parameter" ("name");--> statement-breakpoint
CREATE INDEX "idx_dav_parameter_property" ON "dav_parameter" ("property_id");--> statement-breakpoint
CREATE INDEX "idx_dav_parameter_property_name" ON "dav_parameter" ("property_id","name");--> statement-breakpoint
CREATE INDEX "idx_dav_property_component" ON "dav_property" ("component_id");--> statement-breakpoint
CREATE INDEX "idx_dav_property_component_name" ON "dav_property" ("component_id","name");--> statement-breakpoint
CREATE INDEX "idx_dav_property_deleted_at" ON "dav_property" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_dav_property_name" ON "dav_property" ("name");--> statement-breakpoint
CREATE INDEX "idx_dav_schedule_message_collection" ON "dav_schedule_message" ("collection_id");--> statement-breakpoint
CREATE INDEX "idx_dav_schedule_message_created" ON "dav_schedule_message" ("created_at");--> statement-breakpoint
CREATE INDEX "idx_dav_schedule_message_deleted_at" ON "dav_schedule_message" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_dav_schedule_message_recipient" ON "dav_schedule_message" ("recipient") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_dav_schedule_message_status" ON "dav_schedule_message" ("status") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_dav_shadow_deleted_at" ON "dav_shadow" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_dav_shadow_entity" ON "dav_shadow" ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_dav_shadow_instance" ON "dav_shadow" ("instance_id");--> statement-breakpoint
CREATE INDEX "idx_dav_shadow_request_id" ON "dav_shadow" ("request_id");--> statement-breakpoint
CREATE INDEX "idx_dav_tombstone_collection" ON "dav_tombstone" ("collection_id");--> statement-breakpoint
CREATE INDEX "idx_dav_tombstone_deleted_at" ON "dav_tombstone" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_group_name_group_id" ON "group_name" ("group_id");--> statement-breakpoint
CREATE INDEX "idx_group_name_name" ON "group_name" ("name");--> statement-breakpoint
CREATE INDEX "idx_group_principal" ON "group" ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_group_principal_id" ON "group" ("principal_id");--> statement-breakpoint
CREATE INDEX "idx_membership_group_id" ON "membership" ("group_id");--> statement-breakpoint
CREATE INDEX "idx_membership_user_id" ON "membership" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_principal_deleted_at" ON "principal" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_principal_principal_type" ON "principal" ("principal_type");--> statement-breakpoint
CREATE INDEX "idx_principal_type_active" ON "principal" ("principal_type") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "unique_principal_slug_per_type" ON "principal" ("principal_type","slug") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_user_email_active" ON "user" ("email");--> statement-breakpoint
CREATE INDEX "idx_user_principal" ON "user" ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_principal_id" ON "user" ("principal_id");--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "fk_group_principal" FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_primary_name_fkey" FOREIGN KEY ("primary_name") REFERENCES "group_name"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "fk_user_principal" FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "auth_user" ADD CONSTRAINT "auth_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_name" ADD CONSTRAINT "group_name_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD CONSTRAINT "dav_collection_owner_principal_id_fkey" FOREIGN KEY ("owner_principal_id") REFERENCES "principal"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD CONSTRAINT "dav_collection_parent_collection_id_fkey" FOREIGN KEY ("parent_collection_id") REFERENCES "dav_collection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dav_instance" ADD CONSTRAINT "dav_instance_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "dav_collection"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dav_instance" ADD CONSTRAINT "dav_instance_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "dav_entity"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dav_tombstone" ADD CONSTRAINT "dav_tombstone_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "dav_collection"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dav_tombstone" ADD CONSTRAINT "dav_tombstone_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "dav_entity"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dav_component" ADD CONSTRAINT "dav_component_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "dav_entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dav_component" ADD CONSTRAINT "dav_component_parent_component_id_fkey" FOREIGN KEY ("parent_component_id") REFERENCES "dav_component"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dav_property" ADD CONSTRAINT "dav_property_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "dav_component"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dav_parameter" ADD CONSTRAINT "dav_parameter_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "dav_property"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dav_shadow" ADD CONSTRAINT "dav_shadow_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "dav_entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dav_shadow" ADD CONSTRAINT "dav_shadow_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "dav_instance"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cal_index" ADD CONSTRAINT "cal_index_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "dav_component"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cal_index" ADD CONSTRAINT "cal_index_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "dav_entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "card_index" ADD CONSTRAINT "card_index_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "dav_entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dav_schedule_message" ADD CONSTRAINT "dav_schedule_message_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "dav_collection"("id") ON DELETE CASCADE;
