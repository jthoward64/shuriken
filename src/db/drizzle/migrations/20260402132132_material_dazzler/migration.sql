CREATE TABLE "dav_acl" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid,
	"privilege" text NOT NULL,
	"grant_deny" text DEFAULT 'grant' NOT NULL,
	"protected" boolean DEFAULT false NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "dav_acl_grant_deny_check" CHECK ((grant_deny = ANY (ARRAY['grant'::text, 'deny'::text]))),
	CONSTRAINT "dav_acl_principal_type_check" CHECK ((principal_type = ANY (ARRAY['principal'::text, 'all'::text, 'authenticated'::text, 'unauthenticated'::text, 'self'::text]))),
	CONSTRAINT "dav_acl_resource_type_check" CHECK ((resource_type = ANY (ARRAY['collection'::text, 'instance'::text, 'principal'::text]))),
	CONSTRAINT "dav_acl_principal_id_required" CHECK ((principal_type <> 'principal'::text OR principal_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "group" DROP CONSTRAINT IF EXISTS "group_primary_name_group_name_id_fkey";--> statement-breakpoint
DROP TABLE "casbin_rule";--> statement-breakpoint
DROP TABLE "group_name";--> statement-breakpoint
ALTER TABLE "auth_user" DROP CONSTRAINT IF EXISTS "auth_user_auth_source_auth_id_unique";--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_email_unique";--> statement-breakpoint
ALTER TABLE "dav_collection" ADD COLUMN "client_properties" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD COLUMN "max_resource_size" bigint;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD COLUMN "min_date_time" timestamptz;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD COLUMN "max_date_time" timestamptz;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD COLUMN "max_instances" integer;--> statement-breakpoint
ALTER TABLE "dav_collection" ADD COLUMN "max_attendees_per_instance" integer;--> statement-breakpoint
ALTER TABLE "dav_instance" ADD COLUMN "client_properties" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "dav_schedule_message" ADD COLUMN "entity_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "dav_schedule_message" DROP COLUMN "ical_data";--> statement-breakpoint
ALTER TABLE "group" DROP COLUMN "primary_name";--> statement-breakpoint
CREATE INDEX "idx_dav_acl_resource_principal" ON "dav_acl" ("resource_id","principal_id","privilege");--> statement-breakpoint
CREATE INDEX "idx_dav_acl_resource_ordinal" ON "dav_acl" ("resource_id","ordinal");--> statement-breakpoint
CREATE INDEX "idx_dav_acl_resource_principal_type" ON "dav_acl" ("resource_id","principal_type");--> statement-breakpoint
ALTER TABLE "dav_acl" ADD CONSTRAINT "dav_acl_principal_id_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dav_schedule_message" ADD CONSTRAINT "dav_schedule_message_entity_id_dav_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "dav_entity"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dav_collection" DROP CONSTRAINT IF EXISTS "dav_collection_collection_type_check", ADD CONSTRAINT "dav_collection_collection_type_check" CHECK ((collection_type = ANY (ARRAY['collection'::text, 'calendar'::text, 'addressbook'::text, 'inbox'::text, 'outbox'::text])));