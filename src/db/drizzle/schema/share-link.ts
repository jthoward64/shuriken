import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	pgTable,
	primaryKey,
	text,
	uuid,
} from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { davCollection, user } from "../schema";
import { drizzleEnum, type GetDrizzleEnumType, timestampTz } from "./types";

const shareLinkVisibilityEnum = drizzleEnum(
	"visibility",
	["all", "limited", "free_busy"] as const,
	"text",
);
export type ShareLinkVisibility = GetDrizzleEnumType<
	typeof shareLinkVisibilityEnum
>;

export const shareLink = pgTable("share_link", {
	id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
	enabled: boolean().default(true).notNull(),
	userId: uuid("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" })
		.$type<UuidString>(),
	updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
	expiresAt: timestampTz("expires_at"),
});

export const shareLinkCalendars = pgTable(
	"share_link_calendars",
	{
		shareLinkId: uuid("share_link_id")
			.notNull()
			.references(() => shareLink.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		calendarId: uuid("calendar_id")
			.notNull()
			.references(() => davCollection.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		visibility: text("visibility").notNull().$type<ShareLinkVisibility>(),
	},
	(table) => [
		primaryKey({
			columns: [table.shareLinkId, table.calendarId],
			name: "share_link_calendars_pkey",
		}),
		check("share_link_visibility_check", shareLinkVisibilityEnum.sql),
	],
);
