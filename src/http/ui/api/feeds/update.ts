import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { ShareLinkVisibility } from "#src/db/drizzle/schema/index.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { isUuid, type UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_SEE_OTHER } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import type { AclService } from "#src/services/acl/index.ts";
import {
	type ShareLinkCaller,
	ShareLinkService,
	type ShareLinkSummary,
} from "#src/services/share-link/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/feeds/:id/update
// Updates display name, expiry, enabled flag, and per-calendar visibility
// (add / remove / change visibility) in one form submit.
// ---------------------------------------------------------------------------

const isVisibility = (raw: string): raw is ShareLinkVisibility =>
	raw === "all" || raw === "limited" || raw === "free_busy";

interface FeedCalendarState {
	readonly visibility: ShareLinkVisibility;
	readonly embedEnabled: boolean;
}

// The per-calendar entries the form describes: `calendar` names each desired
// entry, `visibility:<id>` and `embed:<id>` carry its settings
const desiredCalendars = (
	form: FormData,
): ReadonlyMap<UuidString, FeedCalendarState> => {
	const desired = new Map<UuidString, FeedCalendarState>();
	for (const raw of form.getAll("calendar")) {
		const calId = raw.toString();
		if (!isUuid(calId)) {
			continue;
		}
		const visRaw = form.get(`visibility:${calId}`)?.toString() ?? "all";
		desired.set(calId, {
			visibility: isVisibility(visRaw) ? visRaw : "all",
			embedEnabled: form.has(`embed:${calId}`),
		});
	}
	return desired;
};

// The feed's current per-calendar entries, keyed for diffing against the form
const currentCalendars = (
	summary: ShareLinkSummary,
): ReadonlyMap<UuidString, FeedCalendarState> =>
	new Map(
		summary.calendars.map((c) => [
			c.calendarId,
			{ visibility: c.visibility, embedEnabled: c.embedEnabled },
		]),
	);

// Add, update, and remove entries so the feed matches what the form asked for
const reconcileCalendars = Effect.fn("ui.feeds.update.reconcile")(function* (
	id: UuidString,
	caller: ShareLinkCaller,
	desired: ReadonlyMap<UuidString, FeedCalendarState>,
	current: ReadonlyMap<UuidString, FeedCalendarState>,
) {
	const svc = yield* ShareLinkService;
	for (const [calendarId, wanted] of desired) {
		const existing = current.get(calendarId);
		const unchanged =
			existing !== undefined &&
			existing.visibility === wanted.visibility &&
			existing.embedEnabled === wanted.embedEnabled;
		if (unchanged) {
			continue;
		}
		const entry = {
			calendarId,
			visibility: wanted.visibility,
			embedEnabled: wanted.embedEnabled,
		};
		yield* existing === undefined
			? svc.addCalendar(id, caller, entry)
			: svc.setVisibility(id, caller, entry);
	}
	for (const calendarId of current.keys()) {
		if (!desired.has(calendarId)) {
			yield* svc.removeCalendar(id, caller, calendarId);
		}
	}
});

// The feed's expiry, or none when the form leaves it blank
const parseExpiry = (raw: string) =>
	raw === ""
		? Effect.succeed(null)
		: Effect.try({
				try: () => Temporal.Instant.from(raw),
				catch: (e) => new InternalError({ cause: e }),
			});

export const feedsUpdateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	id: UuidString,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ShareLinkService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const svc = yield* ShareLinkService;
		const caller = {
			userId: principal.userId,
			principalId: principal.principalId,
		};

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const displayNameRaw = form.get("displayName")?.toString().trim() ?? "";
		const expiresAt = yield* parseExpiry(
			form.get("expiresAt")?.toString().trim() ?? "",
		);

		yield* svc.update(id, caller, {
			displayName: displayNameRaw === "" ? null : displayNameRaw,
			expiresAt,
			enabled: form.get("enabled")?.toString() === "on",
		});

		// Re-fetch existing state to compute the diff.
		const summaryOpt = yield* svc.getById(id, caller);
		yield* Option.match(summaryOpt, {
			onNone: () => Effect.void,
			onSome: (summary) =>
				reconcileCalendars(
					id,
					caller,
					desiredCalendars(form),
					currentCalendars(summary),
				),
		});

		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: `/ui/feeds/${id}` },
		});
	});
