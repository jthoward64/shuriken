CREATE TABLE "bulk_job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_principal_id" uuid NOT NULL,
	"collection_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total" integer NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"result_blob" bytea,
	"result_filename" text,
	"blob_expires_at" timestamptz,
	"error_message" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_job_kind_check" CHECK ((kind = ANY (ARRAY['import'::text, 'export'::text, 'bulk_delete'::text, 'bulk_clear_photo'::text, 'bulk_download'::text, 'cleanup_fix_all'::text]))),
	CONSTRAINT "bulk_job_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text])))
);
--> statement-breakpoint
CREATE TABLE "oidc_login" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"state" text NOT NULL,
	"pkce_verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"return_to" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"last_seen_at" timestamptz DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "user_email_credential" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"username" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"password_iv" text NOT NULL,
	"security" text NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_credential_security_check" CHECK ((smtp_security = ANY (ARRAY['none'::text, 'starttls'::text, 'tls'::text])))
);
--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "last_used_at" timestamptz;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD COLUMN "sort_order" integer DEFAULT -1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "dav_property" ADD COLUMN "value_datetime_list" dav_datetime;--> statement-breakpoint
ALTER TABLE "group" ADD COLUMN "oidc_groups" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "auto_assigned_by" text;--> statement-breakpoint
ALTER TABLE "share_link" ADD COLUMN "token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "share_link" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "share_link_calendars" ADD COLUMN "embed_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "dav_property" DROP COLUMN "value_tstz_array";--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_token_key" UNIQUE("token");--> statement-breakpoint
CREATE INDEX "idx_bulk_job_owner" ON "bulk_job" ("owner_principal_id");--> statement-breakpoint
CREATE INDEX "idx_bulk_job_status" ON "bulk_job" ("status");--> statement-breakpoint
CREATE INDEX "idx_dav_collection_order" ON "dav_collection" ("owner_principal_id","collection_type","sort_order","id") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_oidc_login_state" ON "oidc_login" ("state");--> statement-breakpoint
CREATE INDEX "idx_oidc_login_expires_at" ON "oidc_login" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_session_token_hash" ON "session" ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_session_user_id" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_session_expires_at" ON "session" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_email_credential_user" ON "user_email_credential" ("user_id");--> statement-breakpoint
ALTER TABLE "bulk_job" ADD CONSTRAINT "bulk_job_owner_principal_id_principal_id_fkey" FOREIGN KEY ("owner_principal_id") REFERENCES "principal"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bulk_job" ADD CONSTRAINT "bulk_job_collection_id_dav_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "dav_collection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_email_credential" ADD CONSTRAINT "user_email_credential_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_auto_assigned_by_check" CHECK ((auto_assigned_by = ANY (ARRAY['oidc'::text])));--> statement-breakpoint
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