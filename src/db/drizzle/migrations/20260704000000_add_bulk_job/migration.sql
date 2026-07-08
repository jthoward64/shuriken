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
	CONSTRAINT "bulk_job_kind_check" CHECK ((kind = ANY (ARRAY['import'::text, 'export'::text, 'bulk_delete'::text, 'bulk_clear_photo'::text, 'bulk_download'::text]))),
	CONSTRAINT "bulk_job_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text])))
);
--> statement-breakpoint
ALTER TABLE "bulk_job" ADD CONSTRAINT "bulk_job_owner_principal_id_principal_id_fkey" FOREIGN KEY ("owner_principal_id") REFERENCES "principal"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "bulk_job" ADD CONSTRAINT "bulk_job_collection_id_dav_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "dav_collection"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "idx_bulk_job_owner" ON "bulk_job" ("owner_principal_id");
--> statement-breakpoint
CREATE INDEX "idx_bulk_job_status" ON "bulk_job" ("status");
