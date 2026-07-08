CREATE TABLE "external_calendar" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"url" text NOT NULL,
	"sync_interval_s" integer NOT NULL,
	"last_sync_at" timestamptz,
	"last_sync_status" text DEFAULT 'never' NOT NULL,
	"last_sync_error" text,
	"http_etag" text,
	"http_last_modified" text,
	"fetched_at" timestamptz,
	"default_displayname" text,
	"default_color" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"deleted_at" timestamptz,
	CONSTRAINT "external_calendar_last_sync_status_check" CHECK ((last_sync_status = ANY (ARRAY['never'::text, 'success'::text, 'failure'::text]))),
	CONSTRAINT "external_calendar_sync_interval_positive" CHECK (sync_interval_s > 0)
);
--> statement-breakpoint
CREATE TABLE "external_calendar_claim" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"external_calendar_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"sync_interval_s" integer NOT NULL,
	"color_override" text,
	"displayname_override" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "external_calendar_claim_sync_interval_positive" CHECK (sync_interval_s > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unique_external_calendar_url_active" ON "external_calendar" ("url") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_external_calendar_due" ON "external_calendar" ("last_sync_at" NULLS FIRST,"sync_interval_s") WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "unique_external_calendar_claim_per_collection" ON "external_calendar_claim" ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_external_calendar_claim_per_url_per_collection" ON "external_calendar_claim" ("external_calendar_id","collection_id");--> statement-breakpoint
CREATE INDEX "idx_external_calendar_claim_url" ON "external_calendar_claim" ("external_calendar_id");--> statement-breakpoint
ALTER TABLE "external_calendar_claim" ADD CONSTRAINT "external_calendar_claim_i86wzdvkDkJb_fkey" FOREIGN KEY ("external_calendar_id") REFERENCES "external_calendar"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "external_calendar_claim" ADD CONSTRAINT "external_calendar_claim_collection_id_dav_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "dav_collection"("id") ON DELETE CASCADE;