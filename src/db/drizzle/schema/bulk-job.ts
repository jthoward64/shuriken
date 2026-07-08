import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	uuid,
} from "drizzle-orm/pg-core";
import type { CollectionId, PrincipalId, UuidString } from "#src/domain/ids.ts";
import { davCollection } from "./dav.ts";
import { principal } from "./principal.ts";
import { bytea, drizzleEnum, timestampTz } from "./types.ts";

export const BULK_JOB_KINDS = [
	"import",
	"export",
	"bulk_delete",
	"bulk_clear_photo",
	"bulk_download",
	"cleanup_fix_all",
] as const;
export type BulkJobKind = (typeof BULK_JOB_KINDS)[number];

export const BULK_JOB_STATUSES = [
	"pending",
	"running",
	"succeeded",
	"failed",
] as const;
export type BulkJobStatus = (typeof BULK_JOB_STATUSES)[number];

export const bulkJob = pgTable(
	"bulk_job",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		ownerPrincipalId: uuid("owner_principal_id")
			.references(() => principal.id, { onDelete: "cascade" })
			.$type<PrincipalId>()
			.notNull(),
		collectionId: uuid("collection_id")
			.references(() => davCollection.id, { onDelete: "cascade" })
			.$type<CollectionId>(),
		kind: text().notNull().$type<BulkJobKind>(),
		status: text().notNull().default("pending").$type<BulkJobStatus>(),
		total: integer().notNull(),
		done: integer().notNull().default(0),
		succeeded: integer().notNull().default(0),
		failed: integer().notNull().default(0),
		input: jsonb().notNull(),
		result: jsonb(),
		resultBlob: bytea("result_blob"),
		resultFilename: text("result_filename"),
		blobExpiresAt: timestampTz("blob_expires_at"),
		errorMessage: text("error_message"),
		createdAt: timestampTz("created_at").default(sql`now()`).notNull(),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
	},
	(table) => [
		index("idx_bulk_job_owner").using("btree", table.ownerPrincipalId.asc()),
		index("idx_bulk_job_status").using("btree", table.status.asc()),
		check(
			"bulk_job_kind_check",
			drizzleEnum("kind", [...BULK_JOB_KINDS], "text").sql,
		),
		check(
			"bulk_job_status_check",
			drizzleEnum("status", [...BULK_JOB_STATUSES], "text").sql,
		),
	],
);
