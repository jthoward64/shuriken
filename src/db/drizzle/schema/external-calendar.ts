import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { davCollection } from "./dav";
import { drizzleEnum, type GetDrizzleEnumType, timestampTz } from "./types";

// ---------------------------------------------------------------------------
// External calendar subscriptions — shared fetch + per-user claims.
//
// One `external_calendar` per unique URL captures the fetched state (events,
// HTTP cache headers, last sync timestamp). Multiple users may "claim" the
// same external calendar by creating an `external_calendar_claim`, which
// associates a local `dav_collection` (visible to that user) with the shared
// fetched data. Each claim picks its own sync interval; the row-level
// `sync_interval_s` on `external_calendar` is the MIN across claims and
// drives how often the background fiber polls the URL.
// ---------------------------------------------------------------------------

// `drizzleEnum`'s first arg is the SQL column name used inside the CHECK
// constraint, not a free-form enum label.
const syncStatusEnum = drizzleEnum(
	"last_sync_status",
	["never", "success", "failure"] as const,
	"text",
);
export type ExternalCalendarSyncStatus = GetDrizzleEnumType<
	typeof syncStatusEnum
>;

export const externalCalendar = pgTable(
	"external_calendar",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		url: text().notNull(),
		/**
		 * Effective sync interval in seconds. Equal to the MIN of all
		 * non-deleted claims' sync_interval_s; recomputed whenever a claim is
		 * inserted, updated, or deleted.
		 */
		syncIntervalS: integer("sync_interval_s").notNull(),
		lastSyncAt: timestampTz("last_sync_at"),
		lastSyncStatus: text("last_sync_status")
			.default("never")
			.notNull()
			.$type<ExternalCalendarSyncStatus>(),
		lastSyncError: text("last_sync_error"),
		/** HTTP ETag from the most recent successful fetch — used for conditional GET. */
		httpEtag: text("http_etag"),
		/** HTTP Last-Modified from the most recent successful fetch — also for conditional GET. */
		httpLastModified: text("http_last_modified"),
		/** When the response body was last parsed (independent of last_sync_at, which records every poll attempt). */
		fetchedAt: timestampTz("fetched_at"),
		/** PRODID/X-WR-CALNAME advertised by the feed; used as default `displayname` for new claims. */
		defaultDisplayname: text("default_displayname"),
		/** Hex colour advertised by the feed (e.g. Apple's X-APPLE-CALENDAR-COLOR). */
		defaultColor: text("default_color"),
		createdAt: timestampTz("created_at").default(sql`now()`).notNull(),
		deletedAt: timestampTz("deleted_at"),
	},
	(table) => [
		uniqueIndex("unique_external_calendar_url_active")
			.using("btree", table.url.asc().nullsLast())
			.where(sql`(deleted_at IS NULL)`),
		index("idx_external_calendar_due")
			.using(
				"btree",
				table.lastSyncAt.asc().nullsFirst(),
				table.syncIntervalS.asc().nullsLast(),
			)
			.where(sql`(deleted_at IS NULL)`),
		check("external_calendar_last_sync_status_check", syncStatusEnum.sql),
		check("external_calendar_sync_interval_positive", sql`sync_interval_s > 0`),
	],
);

export const externalCalendarClaim = pgTable(
	"external_calendar_claim",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		externalCalendarId: uuid("external_calendar_id")
			.notNull()
			.references(() => externalCalendar.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		/**
		 * The local read-only collection that surfaces this subscription to a
		 * single user. The claim and the collection have a 1:1 lifetime
		 * relationship — deleting the claim removes the collection and vice
		 * versa (via the cascade below).
		 */
		collectionId: uuid("collection_id")
			.notNull()
			.references(() => davCollection.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		syncIntervalS: integer("sync_interval_s").notNull(),
		colorOverride: text("color_override"),
		displaynameOverride: text("displayname_override"),
		createdAt: timestampTz("created_at").default(sql`now()`).notNull(),
	},
	(table) => [
		uniqueIndex("unique_external_calendar_claim_per_collection").using(
			"btree",
			table.collectionId.asc().nullsLast(),
		),
		uniqueIndex("unique_external_calendar_claim_per_url_per_collection").using(
			"btree",
			table.externalCalendarId.asc().nullsLast(),
			table.collectionId.asc().nullsLast(),
		),
		index("idx_external_calendar_claim_url").using(
			"btree",
			table.externalCalendarId.asc().nullsLast(),
		),
		check(
			"external_calendar_claim_sync_interval_positive",
			sql`sync_interval_s > 0`,
		),
	],
);
