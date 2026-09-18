import { Effect, Layer, Option } from "effect";
import { Temporal } from "temporal-polyfill";
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
import type { AclServiceShape } from "#src/services/acl/service.ts";
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

/** True when the caller holds DAV:all on the users virtual resource. */
const isAdmin = Effect.fn("ShareLinkService.isAdmin")(function* (
	acl: AclServiceShape,
	caller: ShareLinkCaller,
) {
	return yield* acl
		.check(caller.principalId, USERS_VIRTUAL_RESOURCE_ID, "virtual", "DAV:all")
		.pipe(
			Effect.map(() => true),
			Effect.catchTag("DavError", () => Effect.succeed(false)),
		);
});

/** Fails unless the caller owns the share link or is an admin. */
const requireOwnership = Effect.fn("ShareLinkService.requireOwnership")(
	function* (acl: AclServiceShape, row: ShareLinkRow, caller: ShareLinkCaller) {
		if (row.userId === caller.userId) {
			return;
		}
		const admin = yield* isAdmin(acl, caller);
		if (!admin) {
			return yield* Effect.fail(
				needPrivileges("share link is owned by another user"),
			);
		}
	},
);

/** The share link with that id, failing unless the caller may act on it. */
const loadOwnedLink = Effect.fn("ShareLinkService.loadOwned")(function* (
	deps: {
		readonly repo: ShareLinkRepositoryShape;
		readonly acl: AclServiceShape;
	},
	id: UuidString,
	caller: ShareLinkCaller,
) {
	const opt = yield* deps.repo.findById(id);
	if (Option.isNone(opt)) {
		return yield* Effect.fail(notFound("share link not found"));
	}
	yield* requireOwnership(deps.acl, opt.value, caller);
	return opt.value;
});

export const ShareLinkServiceLive = Layer.effect(
	ShareLinkService,
	Effect.gen(function* () {
		const repo = yield* ShareLinkRepository;
		const acl = yield* AclService;

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

		return {
			listForUser: Effect.fn("ShareLinkService.listForUser")(function* (
				userId: UserId,
			) {
				const rows = yield* repo.findByUser(userId);
				return yield* Effect.forEach(rows, (r) => summarize(repo, r));
			}),

			getById: Effect.fn("ShareLinkService.getById")(function* (id, caller) {
				const opt = yield* repo.findById(id);
				if (Option.isNone(opt)) {
					return Option.none<ShareLinkSummary>();
				}
				yield* requireOwnership(acl, opt.value, caller);
				return Option.some(yield* summarize(repo, opt.value));
			}),

			getActiveByToken: Effect.fn("ShareLinkService.getActiveByToken")(
				function* (token) {
					const opt = yield* repo.findByToken(token);
					if (Option.isNone(opt) || !isActive(opt.value)) {
						return Option.none<ShareLinkSummary>();
					}
					return Option.some(yield* summarize(repo, opt.value));
				},
			),

			create: Effect.fn("ShareLinkService.create")(function* (
				caller: ShareLinkCaller,
				input: CreateShareLinkInput,
			): Generator<
				Effect.Effect<unknown, DatabaseError | DavError | InternalError>,
				ShareLinkSummary
			> {
				yield* Effect.forEach(input.calendars, (c) =>
					requireCalendarReadable(caller, c.calendarId),
				);
				const row = yield* repo.insert({
					userId: caller.userId,
					token: generateShareToken(),
					displayName: input.displayName ?? null,
					expiresAt: input.expiresAt ?? null,
				});
				yield* Effect.forEach(input.calendars, (c) =>
					repo.addCalendar(row.id, c.calendarId, c.visibility, c.embedEnabled),
				);
				return yield* summarize(repo, row);
			}),

			update: Effect.fn("ShareLinkService.update")(function* (
				id,
				caller,
				input: UpdateShareLinkInput,
			) {
				yield* loadOwnedLink({ repo, acl }, id, caller);
				const row = yield* repo.update(id, {
					enabled: input.enabled,
					displayName: input.displayName,
					expiresAt: input.expiresAt,
				});
				return yield* summarize(repo, row);
			}),

			regenerateToken: Effect.fn("ShareLinkService.regenerateToken")(
				function* (id, caller) {
					yield* loadOwnedLink({ repo, acl }, id, caller);
					const token = generateShareToken();
					yield* repo.update(id, { token });
					return token;
				},
			),

			setVisibility: Effect.fn("ShareLinkService.setVisibility")(function* (
				id,
				caller,
				{ calendarId, visibility, embedEnabled },
			) {
				yield* loadOwnedLink({ repo, acl }, id, caller);
				yield* repo.setCalendarVisibility(
					id,
					calendarId,
					visibility,
					embedEnabled,
				);
			}),

			addCalendar: Effect.fn("ShareLinkService.addCalendar")(function* (
				id,
				caller,
				{ calendarId, visibility, embedEnabled },
			) {
				yield* loadOwnedLink({ repo, acl }, id, caller);
				yield* requireCalendarReadable(caller, calendarId);
				yield* repo.addCalendar(id, calendarId, visibility, embedEnabled);
			}),

			removeCalendar: Effect.fn("ShareLinkService.removeCalendar")(function* (
				id,
				caller,
				calendarId: UuidString,
			) {
				yield* loadOwnedLink({ repo, acl }, id, caller);
				yield* repo.removeCalendar(id, calendarId);
			}),

			delete: Effect.fn("ShareLinkService.delete")(function* (id, caller) {
				yield* loadOwnedLink({ repo, acl }, id, caller);
				yield* repo.softDelete(id);
			}),
		};
	}),
);
