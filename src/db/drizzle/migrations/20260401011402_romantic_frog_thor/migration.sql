ALTER TABLE "casbin_rule" ALTER COLUMN "ptype" SET DATA TYPE text USING "ptype"::text;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "ptype" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v0" SET DATA TYPE text USING "v0"::text;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v0" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v0" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v1" SET DATA TYPE text USING "v1"::text;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v1" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v1" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v2" SET DATA TYPE text USING "v2"::text;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v2" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v2" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v3" SET DATA TYPE text USING "v3"::text;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v3" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v3" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v4" SET DATA TYPE text USING "v4"::text;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v4" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v4" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v5" SET DATA TYPE text USING "v5"::text;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v5" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "casbin_rule" ALTER COLUMN "v5" DROP NOT NULL;