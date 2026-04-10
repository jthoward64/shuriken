ALTER TABLE "dav_collection" ADD COLUMN "schedule_transp" text DEFAULT 'opaque';--> statement-breakpoint
ALTER TABLE "dav_collection" ADD COLUMN "schedule_default_calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD CONSTRAINT "dav_collection_schedule_default_calendar_id_fkey" FOREIGN KEY ("schedule_default_calendar_id") REFERENCES "dav_collection"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD CONSTRAINT "dav_collection_schedule_transp_check" CHECK (schedule_transp IN ('opaque', 'transparent'));