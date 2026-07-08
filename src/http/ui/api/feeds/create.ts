import { Effect } from "effect";
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
import { ShareLinkService } from "#src/services/share-link/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/feeds/create
// Form fields:
//   displayName?        — human label
//   expiresAt?          — ISO instant string (empty = no expiry)
//   calendar            — repeated: calendar UUIDs to share
//   visibility:<uuid>   — visibility selector per calendar
// ---------------------------------------------------------------------------

const isVisibility = (raw: string): raw is ShareLinkVisibility =>
	raw === "all" || raw === "limited" || raw === "free_busy";

export const feedsCreateHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ShareLinkService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const svc = yield* ShareLinkService;

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const displayNameRaw = form.get("displayName")?.toString().trim() ?? "";
		const displayName = displayNameRaw === "" ? null : displayNameRaw;
		const expiresRaw = form.get("expiresAt")?.toString().trim() ?? "";
		const expiresAt =
			expiresRaw === ""
				? null
				: yield* Effect.try({
						try: () => Temporal.Instant.from(expiresRaw),
						catch: (e) => new InternalError({ cause: e }),
					});

		const calendars: Array<{
			calendarId: UuidString;
			visibility: ShareLinkVisibility;
			embedEnabled: boolean;
		}> = [];
		for (const raw of form.getAll("calendar")) {
			const calId = raw.toString();
			if (!isUuid(calId)) {
				continue;
			}
			const visRaw = form.get(`visibility:${calId}`)?.toString() ?? "all";
			const visibility = isVisibility(visRaw) ? visRaw : "all";
			calendars.push({
				calendarId: calId as UuidString,
				visibility,
				embedEnabled: form.has(`embed:${calId}`),
			});
		}

		const summary = yield* svc.create(
			{ userId: principal.userId, principalId: principal.principalId },
			{ displayName, expiresAt, calendars },
		);

		// The calendar sidebar's edit popover passes returnTo=/ui/calendar so it
		// lands back on the calendar view instead of the new feed's edit page.
		const returnTo =
			form.get("returnTo")?.toString() || `/ui/feeds/${summary.link.id}`;
		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: returnTo },
		});
	});
