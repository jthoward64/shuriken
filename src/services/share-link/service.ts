import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { ShareLinkVisibility } from "#src/db/drizzle/schema/index.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId, UserId, UuidString } from "#src/domain/ids.ts";
import type { ShareLinkCalendarRow, ShareLinkRow } from "./repository.ts";

// ---------------------------------------------------------------------------
// ShareLinkService — CRUD around share_link + share_link_calendars, with
// ACL guards. Mutations verify the caller owns the link (link.userId ===
// caller.userId) or is an admin (DAV:all on their own principal). Creation
// and addCalendar additionally require DAV:read on each referenced calendar.
//
// Public lookups (by token) intentionally do NOT take a caller — the feed
// handler runs unauthenticated. The service still applies the enabled /
// expires_at gate so disabled or expired links 404.
// ---------------------------------------------------------------------------

export interface ShareLinkSummary {
	readonly link: ShareLinkRow;
	readonly calendars: ReadonlyArray<ShareLinkCalendarRow>;
}

export interface ShareLinkCaller {
	readonly userId: UserId;
	readonly principalId: PrincipalId;
}

export interface CreateShareLinkInput {
	readonly displayName?: string | null;
	readonly expiresAt?: Temporal.Instant | null;
	readonly calendars: ReadonlyArray<{
		readonly calendarId: UuidString;
		readonly visibility: ShareLinkVisibility;
		readonly embedEnabled?: boolean;
	}>;
}

export interface UpdateShareLinkInput {
	readonly enabled?: boolean;
	readonly displayName?: string | null;
	readonly expiresAt?: Temporal.Instant | null;
}

export interface ShareLinkServiceShape {
	readonly listForUser: (
		userId: UserId,
	) => Effect.Effect<ReadonlyArray<ShareLinkSummary>, DatabaseError>;

	readonly getById: (
		id: UuidString,
		caller: ShareLinkCaller,
	) => Effect.Effect<Option.Option<ShareLinkSummary>, DatabaseError | DavError>;

	/** Public, unauthenticated lookup. Returns None if disabled, expired, or unknown. */
	readonly getActiveByToken: (
		token: string,
	) => Effect.Effect<Option.Option<ShareLinkSummary>, DatabaseError>;

	readonly create: (
		caller: ShareLinkCaller,
		input: CreateShareLinkInput,
	) => Effect.Effect<
		ShareLinkSummary,
		DatabaseError | DavError | InternalError
	>;

	readonly update: (
		id: UuidString,
		caller: ShareLinkCaller,
		input: UpdateShareLinkInput,
	) => Effect.Effect<ShareLinkSummary, DatabaseError | DavError>;

	/** Returns the new token. */
	readonly regenerateToken: (
		id: UuidString,
		caller: ShareLinkCaller,
	) => Effect.Effect<string, DatabaseError | DavError>;

	readonly setVisibility: (
		id: UuidString,
		caller: ShareLinkCaller,
		calendarId: UuidString,
		visibility: ShareLinkVisibility,
		embedEnabled?: boolean,
	) => Effect.Effect<void, DatabaseError | DavError>;

	readonly addCalendar: (
		id: UuidString,
		caller: ShareLinkCaller,
		calendarId: UuidString,
		visibility: ShareLinkVisibility,
		embedEnabled?: boolean,
	) => Effect.Effect<void, DatabaseError | DavError>;

	readonly removeCalendar: (
		id: UuidString,
		caller: ShareLinkCaller,
		calendarId: UuidString,
	) => Effect.Effect<void, DatabaseError | DavError>;

	readonly delete: (
		id: UuidString,
		caller: ShareLinkCaller,
	) => Effect.Effect<void, DatabaseError | DavError>;
}

export class ShareLinkService extends Context.Service<
	ShareLinkService,
	ShareLinkServiceShape
>()("ShareLinkService") {}
