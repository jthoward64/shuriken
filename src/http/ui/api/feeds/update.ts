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
// POST /ui/api/feeds/:id/update
// Updates display name, expiry, enabled flag, and per-calendar visibility
// (add / remove / change visibility) in one form submit.
// ---------------------------------------------------------------------------

const isVisibility = (raw: string): raw is ShareLinkVisibility =>
	raw === "all" || raw === "limited" || raw === "free_busy";

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
		const displayName = displayNameRaw === "" ? null : displayNameRaw;
		const expiresRaw = form.get("expiresAt")?.toString().trim() ?? "";
		const expiresAt =
			expiresRaw === ""
				? null
				: yield* Effect.try({
						try: () => Temporal.Instant.from(expiresRaw),
						catch: (e) => new InternalError({ cause: e }),
					});
		const enabled = form.get("enabled")?.toString() === "on";

		yield* svc.update(id, caller, { displayName, expiresAt, enabled });

		// Reconcile calendars: form sends `calendar` for each desired entry +
		// `visibility:<id>` for each.
		const desired = new Map<UuidString, ShareLinkVisibility>();
		for (const raw of form.getAll("calendar")) {
			const calId = raw.toString();
			if (!isUuid(calId)) {
				continue;
			}
			const visRaw = form.get(`visibility:${calId}`)?.toString() ?? "all";
			desired.set(calId as UuidString, isVisibility(visRaw) ? visRaw : "all");
		}

		// Re-fetch existing state to compute the diff.
		const summaryOpt = yield* svc.getById(id, caller);
		if (summaryOpt._tag === "Some") {
			const current = new Map(
				summaryOpt.value.calendars.map((c) => [c.calendarId, c.visibility]),
			);
			for (const [calId, vis] of desired) {
				const existingVis = current.get(calId);
				if (existingVis === undefined) {
					yield* svc.addCalendar(id, caller, calId, vis);
				} else if (existingVis !== vis) {
					yield* svc.setVisibility(id, caller, calId, vis);
				}
			}
			for (const calId of current.keys()) {
				if (!desired.has(calId)) {
					yield* svc.removeCalendar(id, caller, calId);
				}
			}
		}

		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: `/ui/feeds/${id}` },
		});
	});
