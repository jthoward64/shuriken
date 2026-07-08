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
	readonly findByToken: (
		token: string,
	) => Effect.Effect<Option.Option<ShareLinkRow>, DatabaseError>;
	readonly findByUser: (
		userId: UserId,
	) => Effect.Effect<ReadonlyArray<ShareLinkRow>, DatabaseError>;
	readonly listCalendars: (
		linkId: UuidString,
	) => Effect.Effect<ReadonlyArray<ShareLinkCalendarRow>, DatabaseError>;
	readonly insert: (input: {
		readonly userId: UserId;
		readonly token: string;
		readonly displayName?: string | null;
		readonly expiresAt?: Temporal.Instant | null;
		readonly enabled?: boolean;
	}) => Effect.Effect<ShareLinkRow, DatabaseError>;
	readonly update: (
		id: UuidString,
		input: {
			readonly enabled?: boolean;
			readonly token?: string;
			readonly displayName?: string | null;
			readonly expiresAt?: Temporal.Instant | null;
		},
	) => Effect.Effect<ShareLinkRow, DatabaseError>;
	readonly softDelete: (id: UuidString) => Effect.Effect<void, DatabaseError>;
	readonly addCalendar: (
		linkId: UuidString,
		calendarId: UuidString,
		visibility: ShareLinkVisibility,
		embedEnabled?: boolean,
	) => Effect.Effect<ShareLinkCalendarRow, DatabaseError>;
	readonly setCalendarVisibility: (
		linkId: UuidString,
		calendarId: UuidString,
		visibility: ShareLinkVisibility,
		embedEnabled?: boolean,
	) => Effect.Effect<void, DatabaseError>;
	readonly removeCalendar: (
		linkId: UuidString,
		calendarId: UuidString,
	) => Effect.Effect<void, DatabaseError>;
}

export class ShareLinkRepository extends Context.Service<
	ShareLinkRepository,
	ShareLinkRepositoryShape
>()("ShareLinkRepository") {}
