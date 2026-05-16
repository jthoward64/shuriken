import { Effect } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { AclService } from "#src/services/acl/service.ts";
import { exportCalendarToIcs } from "#src/services/cal-edit/export-ics.ts";
import type { ComponentRepository } from "#src/services/component/repository.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/calendar/:collectionId/export.ics
//
// Streams the calendar's contents as a single VCALENDAR with VTIMEZONEs
// deduped. Requires DAV:read on the collection.
// ---------------------------------------------------------------------------

const sanitize = (raw: string): string =>
	raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "calendar";

export const calendarExportHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
	filenameHint: string,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		yield* acl.check(
			principal.principalId,
			collectionId,
			"collection",
			"DAV:read",
		);
		const body = yield* exportCalendarToIcs(collectionId);
		const bytes = new TextEncoder().encode(body);
		const filename = `${sanitize(filenameHint)}.ics`;
		return new Response(bytes, {
			status: HTTP_OK,
			headers: {
				"Content-Type": "text/calendar; charset=utf-8",
				"Content-Length": String(bytes.byteLength),
				"Content-Disposition": `attachment; filename="${filename}"`,
			},
		});
	});
