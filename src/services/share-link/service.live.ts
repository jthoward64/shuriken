import { Effect, Layer, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { ShareLinkVisibility } from "#src/db/drizzle/schema/index.ts";
import {
	type DatabaseError,
	type DavError,
	type InternalError,
	needPrivileges,
	notFound,
} from "#src/domain/errors.ts";
import { CollectionId, type UserId, type UuidString } from "#src/domain/ids.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import { AclService } from "#src/services/acl/index.ts";
import {
	ShareLinkRepository,
	type ShareLinkRepositoryShape,
	type ShareLinkRow,
} from "./repository.ts";
import {
	type CreateShareLinkInput,
	type ShareLinkCaller,
	ShareLinkService,
	type ShareLinkSummary,
	type UpdateShareLinkInput,
} from "./service.ts";
import { generateShareToken } from "./token.ts";

// ---------------------------------------------------------------------------
// ShareLinkService — live implementation
//
// Authorization model:
//   * Ownership: caller.userId === link.userId
//   * Admin override: DAV:all on the users virtual resource
// Either grants management rights. Calendar references additionally require
// DAV:read on each calendar (so a feed cannot expose a calendar the caller
// can't see themselves).
// ---------------------------------------------------------------------------

const isActive = (row: ShareLinkRow): boolean => {
	if (!row.enabled) {
		return false;
	}
	if (row.expiresAt === null) {
		return true;
	}
	return Temporal.Instant.compare(row.expiresAt, Temporal.Now.instant()) > 0;
};

const summarize = (
	repo: ShareLinkRepositoryShape,
	row: ShareLinkRow,
): Effect.Effect<ShareLinkSummary, DatabaseError> =>
	repo
		.listCalendars(row.id)
		.pipe(Effect.map((calendars) => ({ link: row, calendars })));

export const ShareLinkServiceLive = Layer.effect(
	ShareLinkService,
	Effect.gen(function* () {
		const repo = yield* ShareLinkRepository;
		const acl = yield* AclService;

		const isAdmin = (caller: ShareLinkCaller) =>
			acl
				.check(
					caller.principalId,
					USERS_VIRTUAL_RESOURCE_ID,
					"virtual",
					"DAV:all",
				)
				.pipe(
					Effect.as(true),
					Effect.catchTag("DavError", () => Effect.succeed(false)),
				);

		const requireOwnership = (
			row: ShareLinkRow,
			caller: ShareLinkCaller,
		): Effect.Effect<void, DavError | DatabaseError> =>
			Effect.gen(function* () {
				if (row.userId === caller.userId) {
					return;
				}
				const admin = yield* isAdmin(caller);
				if (!admin) {
					return yield* Effect.fail(
						needPrivileges("share link is owned by another user"),
					);
				}
			});

		const requireCalendarReadable = (
			caller: ShareLinkCaller,
			calendarId: UuidString,
		): Effect.Effect<void, DavError | DatabaseError> =>
			acl.check(
				caller.principalId,
				CollectionId(calendarId),
				"collection",
				"DAV:read",
			);

		const loadOwned = (id: UuidString, caller: ShareLinkCaller) =>
			Effect.gen(function* () {
				const opt = yield* repo.findById(id);
				if (Option.isNone(opt)) {
					return yield* Effect.fail(notFound("share link not found"));
				}
				yield* requireOwnership(opt.value, caller);
				return opt.value;
			});

		return {
			listForUser: (userId: UserId) =>
				Effect.gen(function* () {
					const rows = yield* repo.findByUser(userId);
					return yield* Effect.forEach(rows, (r) => summarize(repo, r));
				}),

			getById: (id, caller) =>
				Effect.gen(function* () {
					const opt = yield* repo.findById(id);
					if (Option.isNone(opt)) {
						return Option.none<ShareLinkSummary>();
					}
					yield* requireOwnership(opt.value, caller);
					return Option.some(yield* summarize(repo, opt.value));
				}),

			getActiveByToken: (token) =>
				Effect.gen(function* () {
					const opt = yield* repo.findByToken(token);
					if (Option.isNone(opt)) {
						return Option.none<ShareLinkSummary>();
					}
					if (!isActive(opt.value)) {
						return Option.none<ShareLinkSummary>();
					}
					return Option.some(yield* summarize(repo, opt.value));
				}),

			create: (
				caller: ShareLinkCaller,
				input: CreateShareLinkInput,
			): Effect.Effect<
				ShareLinkSummary,
				DatabaseError | DavError | InternalError
			> =>
				Effect.gen(function* () {
					yield* Effect.forEach(input.calendars, (c) =>
						requireCalendarReadable(caller, c.calendarId),
					);
					const token = generateShareToken();
					const row = yield* repo.insert({
						userId: caller.userId,
						token,
						displayName: input.displayName ?? null,
						expiresAt: input.expiresAt ?? null,
					});
					yield* Effect.forEach(input.calendars, (c) =>
						repo.addCalendar(
							row.id,
							c.calendarId,
							c.visibility,
							c.embedEnabled,
						),
					);
					return yield* summarize(repo, row);
				}),

			update: (id, caller, input: UpdateShareLinkInput) =>
				Effect.gen(function* () {
					yield* loadOwned(id, caller);
					const row = yield* repo.update(id, {
						enabled: input.enabled,
						displayName: input.displayName,
						expiresAt: input.expiresAt,
					});
					return yield* summarize(repo, row);
				}),

			regenerateToken: (id, caller) =>
				Effect.gen(function* () {
					yield* loadOwned(id, caller);
					const token = generateShareToken();
					yield* repo.update(id, { token });
					return token;
				}),

			setVisibility: (
				id,
				caller,
				calendarId: UuidString,
				visibility: ShareLinkVisibility,
				embedEnabled?: boolean,
			) =>
				Effect.gen(function* () {
					yield* loadOwned(id, caller);
					yield* repo.setCalendarVisibility(
						id,
						calendarId,
						visibility,
						embedEnabled,
					);
				}),

			addCalendar: (
				id,
				caller,
				calendarId: UuidString,
				visibility: ShareLinkVisibility,
				embedEnabled?: boolean,
			) =>
				Effect.gen(function* () {
					yield* loadOwned(id, caller);
					yield* requireCalendarReadable(caller, calendarId);
					yield* repo.addCalendar(id, calendarId, visibility, embedEnabled);
				}),

			removeCalendar: (id, caller, calendarId: UuidString) =>
				Effect.gen(function* () {
					yield* loadOwned(id, caller);
					yield* repo.removeCalendar(id, calendarId);
				}),

			delete: (id, caller) =>
				Effect.gen(function* () {
					yield* loadOwned(id, caller);
					yield* repo.softDelete(id);
				}),
		};
	}),
);
