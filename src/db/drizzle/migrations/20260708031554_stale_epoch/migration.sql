ALTER TABLE "share_link" ADD CONSTRAINT "share_link_token_key" UNIQUE("token");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_email_credential" ADD CONSTRAINT "user_email_credential_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bulk_job" DROP CONSTRAINT "bulk_job_kind_check", ADD CONSTRAINT "bulk_job_kind_check" CHECK ((kind = ANY (ARRAY['import'::text, 'export'::text, 'bulk_delete'::text, 'bulk_clear_photo'::text, 'bulk_download'::text, 'cleanup_fix_all'::text])));--> statement-breakpoint
ALTER TABLE "dav_property" DROP CONSTRAINT "chk_dav_property_single_value", ADD CONSTRAINT "chk_dav_property_single_value" CHECK ((((((((((((((
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
END) <= 1));--> statement-breakpoint
ALTER TABLE "dav_property" DROP CONSTRAINT "chk_dav_property_value_matches_type", ADD CONSTRAINT "chk_dav_property_value_matches_type" CHECK ((((value_text IS NULL) OR (value_type = ANY (ARRAY['TEXT'::text, 'DURATION'::text, 'URI'::text, 'UTC_OFFSET'::text, 'TIME'::text, 'DATE_AND_OR_TIME'::text, 'RECUR'::text, 'CAL_ADDRESS'::text, 'PERIOD'::text]))) AND ((value_int IS NULL) OR (value_type = 'INTEGER'::text)) AND ((value_float IS NULL) OR (value_type = 'FLOAT'::text)) AND ((value_bool IS NULL) OR (value_type = 'BOOLEAN'::text)) AND ((value_date IS NULL) OR (value_type = 'DATE'::text)) AND ((value_tstz IS NULL) OR (value_type = 'DATE_TIME'::text)) AND ((value_plain_datetime IS NULL) OR (value_type = 'PLAIN_DATE_TIME'::text)) AND ((value_bytes IS NULL) OR (value_type = 'BINARY'::text)) AND ((value_json IS NULL) OR (value_type = 'JSON'::text)) AND ((value_text_array IS NULL) OR (value_type = ANY (ARRAY['TEXT_LIST'::text, 'PERIOD_LIST'::text]))) AND ((value_date_array IS NULL) OR (value_type = 'DATE_LIST'::text)) AND ((value_datetime_list IS NULL) OR (value_type = 'DATE_TIME_LIST'::text)) AND ((value_interval IS NULL) OR (value_type = ANY (ARRAY['DURATION_INTERVAL'::text, 'UTC_OFFSET_INTERVAL'::text])))));
