-- ---------------------------------------------------------------------------
-- DATE_TIME_LIST: support floating (and mixed) items.
--
-- EXDATE/RDATE values may be floating local times (RFC 5545 Form 1) — and MUST
-- be floating for RDATE inside a VTIMEZONE observance (RFC 5545 §3.6.5). The
-- old `value_tstz_array` (timestamptz[]) could only hold anchored instants, so
-- importing such calendars failed outright.
--
-- New model: each list item is a local wall-clock + an optional zone, stored as
-- an array of the `dav_datetime` composite type. A NULL zone marks a floating
-- item; a ZonedDateTime is reconstructed from wall+zone — the faithful
-- iCalendar reading of a Form-2/3 value, rather than a derived instant.
--
-- Backfill is best-effort UTC: existing instants become UTC wall-clocks with a
-- 'UTC' zone. Rows that originally carried a named TZID would have their stored
-- instant reinterpreted as UTC here; re-importing those objects restores full
-- fidelity. (Agreed with maintainer: no real anchored-list data predates this.)
-- ---------------------------------------------------------------------------

CREATE TYPE "dav_datetime" AS ("wall" timestamp, "zone" text);
--> statement-breakpoint

ALTER TABLE "dav_property" ADD COLUMN "value_datetime_list" "dav_datetime"[];
--> statement-breakpoint

UPDATE "dav_property"
SET "value_datetime_list" = (
	SELECT array_agg(ROW((ts AT TIME ZONE 'UTC')::timestamp, 'UTC')::"dav_datetime" ORDER BY ord)
	FROM unnest("value_tstz_array") WITH ORDINALITY AS u(ts, ord)
)
WHERE "value_type" = 'DATE_TIME_LIST' AND "value_tstz_array" IS NOT NULL;
--> statement-breakpoint

-- Rebuild the two check constraints that referenced value_tstz_array, then drop
-- the column. value_datetime_list is now the single "value" column for
-- DATE_TIME_LIST.
ALTER TABLE "dav_property" DROP CONSTRAINT "chk_dav_property_single_value";
--> statement-breakpoint

ALTER TABLE "dav_property" DROP CONSTRAINT "chk_dav_property_value_matches_type";
--> statement-breakpoint

ALTER TABLE "dav_property" DROP COLUMN "value_tstz_array";
--> statement-breakpoint

ALTER TABLE "dav_property" ADD CONSTRAINT "chk_dav_property_single_value" CHECK ((((((((((((((
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
    WHEN (value_plain_datetime IS NOT NULL) THEN 1
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
    WHEN (value_datetime_list IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_interval IS NOT NULL) THEN 1
    ELSE 0
END) <= 1));
--> statement-breakpoint

ALTER TABLE "dav_property" ADD CONSTRAINT "chk_dav_property_value_matches_type" CHECK ((((value_text IS NULL) OR (value_type = ANY (ARRAY['TEXT'::text, 'DURATION'::text, 'URI'::text, 'UTC_OFFSET'::text, 'TIME'::text, 'DATE_AND_OR_TIME'::text, 'RECUR'::text, 'CAL_ADDRESS'::text, 'PERIOD'::text]))) AND ((value_int IS NULL) OR (value_type = 'INTEGER'::text)) AND ((value_float IS NULL) OR (value_type = 'FLOAT'::text)) AND ((value_bool IS NULL) OR (value_type = 'BOOLEAN'::text)) AND ((value_date IS NULL) OR (value_type = 'DATE'::text)) AND ((value_tstz IS NULL) OR (value_type = 'DATE_TIME'::text)) AND ((value_plain_datetime IS NULL) OR (value_type = 'PLAIN_DATE_TIME'::text)) AND ((value_bytes IS NULL) OR (value_type = 'BINARY'::text)) AND ((value_json IS NULL) OR (value_type = 'JSON'::text)) AND ((value_text_array IS NULL) OR (value_type = ANY (ARRAY['TEXT_LIST'::text, 'PERIOD_LIST'::text]))) AND ((value_date_array IS NULL) OR (value_type = 'DATE_LIST'::text)) AND ((value_datetime_list IS NULL) OR (value_type = 'DATE_TIME_LIST'::text)) AND ((value_interval IS NULL) OR (value_type = ANY (ARRAY['DURATION_INTERVAL'::text, 'UTC_OFFSET_INTERVAL'::text])))));
