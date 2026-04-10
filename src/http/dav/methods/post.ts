// ---------------------------------------------------------------------------
// POST handler — RFC 6638 §5 (outbox free-busy request)
//
// Only accepted on the scheduling outbox collection.  The client sends an
// iCalendar document with METHOD:REQUEST and a VFREEBUSY component listing
// the ATTENDEEs to query.  The server aggregates free-busy from each
// attendee's opaque calendar collections and returns a VCALENDAR response.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { decodeICalendar } from "#src/data/icalendar/codec.ts";
import {
	badRequest,
	type DatabaseError,
	type DavError,
	methodNotAllowed,
	unauthorized,
} from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { SchedulingService } from "#src/services/scheduling/index.ts";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const postHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	SchedulingService | AclService
> =>
	Effect.gen(function* () {
		// Only outbox collections accept POST.
		if (path.kind !== "collection" || path.namespace !== "outbox") {
			return yield* methodNotAllowed(
				"POST is only supported on scheduling outbox collections",
			);
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const principal = ctx.auth.principal;

		// RFC 6638 §6.1.4: require schedule-send-freebusy on the outbox.
		const acl = yield* AclService;
		yield* acl.check(
			principal.principalId,
			path.collectionId,
			"collection",
			"CALDAV:schedule-send-freebusy",
		);

		// Parse body as iCalendar.
		const body = yield* Effect.promise(() => req.text());
		const doc = yield* decodeICalendar(body);

		// Validate METHOD:REQUEST.
		const methodProp = doc.root.properties.find((p) => p.name === "METHOD");
		if (
			!methodProp ||
			methodProp.value.type !== "TEXT" ||
			methodProp.value.value !== "REQUEST"
		) {
			return yield* badRequest(
				"Outbox POST requires METHOD:REQUEST in the iCalendar body",
			);
		}

		// Must contain a VFREEBUSY component.
		const hasFreebusy = doc.root.components.some(
			(c) => c.name === "VFREEBUSY",
		);
		if (!hasFreebusy) {
			return yield* badRequest(
				"Outbox POST requires a VFREEBUSY component",
			);
		}

		// Delegate to SchedulingService.
		const schedulingSvc = yield* SchedulingService;
		const calendarText = yield* schedulingSvc.processOutboxPost({
			actingPrincipalId: principal.principalId,
			doc,
		});

		const bodyBytes = new TextEncoder().encode(calendarText);
		return new Response(bodyBytes, {
			status: HTTP_OK,
			headers: {
				"Content-Type": "text/calendar; charset=utf-8",
				"Content-Length": String(bodyBytes.byteLength),
			},
		});
	});
