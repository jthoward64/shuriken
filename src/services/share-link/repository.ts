import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { Temporal } from "temporal-polyfill";
import type {
	ShareLinkVisibility,
	shareLink,
	shareLinkCalendars,
} from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { UserId, UuidString } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// ShareLinkRepository — data access for share_link + share_link_calendars rows
// ---------------------------------------------------------------------------

export type ShareLinkRow = InferSelectModel<typeof shareLink>;
export type ShareLinkCalendarRow = InferSelectModel<typeof shareLinkCalendars>;

export interface ShareLinkRepositoryShape {
	readonly findById: (
		id: UuidString,
	) => Effect.Effect<Option.Option<ShareLinkRow>, DatabaseError>;
	readonly findByUser: (
		userId: UserId,
	) => Effect.Effect<ReadonlyArray<ShareLinkRow>, DatabaseError>;
	readonly listCalendars: (
		linkId: UuidString,
	) => Effect.Effect<ReadonlyArray<ShareLinkCalendarRow>, DatabaseError>;
	readonly insert: (input: {
		readonly userId: UserId;
		readonly expiresAt?: Temporal.Instant;
		readonly enabled?: boolean;
	}) => Effect.Effect<ShareLinkRow, DatabaseError>;
	readonly update: (
		id: UuidString,
		input: {
			readonly enabled?: boolean;
			readonly expiresAt?: Temporal.Instant;
		},
	) => Effect.Effect<ShareLinkRow, DatabaseError>;
	readonly softDelete: (id: UuidString) => Effect.Effect<void, DatabaseError>;
	readonly addCalendar: (
		linkId: UuidString,
		calendarId: UuidString,
		visibility: ShareLinkVisibility,
	) => Effect.Effect<ShareLinkCalendarRow, DatabaseError>;
	readonly removeCalendar: (
		linkId: UuidString,
		calendarId: UuidString,
	) => Effect.Effect<void, DatabaseError>;
}

export class ShareLinkRepository extends Context.Tag("ShareLinkRepository")<
	ShareLinkRepository,
	ShareLinkRepositoryShape
>() {}
