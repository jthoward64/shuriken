import { Effect } from "effect";
import type { DatabaseClient } from "#src/db/client.ts";
import {
	badRequest,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_SEE_OTHER } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { renderFragment } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/service.ts";
import {
	type ImportMode,
	importIcs,
} from "#src/services/cal-edit/import-ics.ts";
import type { ComponentRepository } from "#src/services/component/repository.ts";
import type { EntityRepository } from "#src/services/entity/repository.ts";
import type { InstanceService } from "#src/services/instance/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/calendar/:collectionId/import
//
// Multipart form upload:
//   * `file`  — the .ics blob
//   * `mode`  — "error" | "skip" | "merge" (default "error")
//
// On success redirects to the calendar viewer with a flash query string;
// on conflict in error-mode returns a 200 JSON body listing the conflicting
// UIDs so the UI can offer retry-with-skip / retry-with-merge.
// ---------------------------------------------------------------------------

const isImportMode = (raw: string): raw is ImportMode =>
	raw === "error" || raw === "skip" || raw === "merge";

export const calendarImportHandler = (
	req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| ComponentRepository
	| DatabaseClient
	| EntityRepository
	| InstanceService
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		yield* acl.check(
			principal.principalId,
			collectionId,
			"collection",
			"DAV:bind",
		);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const file = form.get("file");
		if (!(file instanceof File)) {
			return yield* Effect.fail(badRequest("missing 'file' upload"));
		}
		const modeRaw = form.get("mode")?.toString() ?? "error";
		if (!isImportMode(modeRaw)) {
			return yield* Effect.fail(badRequest("invalid mode"));
		}

		const text = yield* Effect.tryPromise({
			try: () => file.text(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const result = yield* importIcs(collectionId, text, modeRaw);
		const htmx = isHtmxRequest(ctx.headers);

		if (modeRaw === "error" && result.conflicts.length > 0) {
			if (htmx) {
				return yield* renderFragment("partials/import-result", {
					conflict: true,
					conflicts: result.conflicts,
				});
			}
			// Fallback for non-HTMX: redirect with conflict count.
			return new Response(null, {
				status: HTTP_SEE_OTHER,
				headers: {
					Location: `/ui/calendar?conflicts=${result.conflicts.length}`,
				},
			});
		}

		if (htmx) {
			return yield* renderFragment("partials/import-result", {
				conflict: false,
				inserted: result.inserted,
				skipped: result.skipped,
				merged: result.merged,
				total: result.inserted + result.skipped + result.merged,
			});
		}

		const params = new URLSearchParams({
			imported: String(result.inserted),
			skipped: String(result.skipped),
			merged: String(result.merged),
		});
		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: `/ui/calendar?${params.toString()}` },
		});
	});
