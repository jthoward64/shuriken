CREATE TABLE "share_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"enabled" boolean DEFAULT true NOT NULL,
	"user_id" uuid NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"expires_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "share_link_calendars" (
	"share_link_id" uuid,
	"calendar_id" uuid,
	"visibility" text NOT NULL,
	CONSTRAINT "share_link_calendars_pkey" PRIMARY KEY("share_link_id","calendar_id"),
	CONSTRAINT "share_link_visibility_check" CHECK ((visibility = ANY (ARRAY['all'::text, 'limited'::text, 'free_busy'::text])))
);
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "share_link_calendars" ADD CONSTRAINT "share_link_calendars_share_link_id_share_link_id_fkey" FOREIGN KEY ("share_link_id") REFERENCES "share_link"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "share_link_calendars" ADD CONSTRAINT "share_link_calendars_calendar_id_dav_collection_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "dav_collection"("id") ON DELETE CASCADE;