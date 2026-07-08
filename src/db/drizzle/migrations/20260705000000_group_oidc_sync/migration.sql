ALTER TABLE "group" ADD COLUMN "oidc_groups" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "auto_assigned_by" text;
--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_auto_assigned_by_check" CHECK ((auto_assigned_by = ANY (ARRAY['oidc'::text])));
