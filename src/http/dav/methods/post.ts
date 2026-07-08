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
import { buildXml } from "#src/http/dav/xml/builder.ts";
import { HTTP_OK } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { SchedulingService } from "#src/services/scheduling/index.ts";
import type { OutboxFreeBusyResult } from "#src/services/scheduling/service.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";

// RFC 6638 §6.2.2 / §10.2: an outbox POST response is a CALDAV:schedule-response
// with one CALDAV:response per recipient. Each carries the recipient href and an
// iTIP REQUEST-STATUS (RFC 5546 §3.6): "2.0;Success" with the recipient's
// free-busy calendar-data, or "3.7;Invalid Calendar User" when unresolvable.
const buildScheduleResponse = (
	results: ReadonlyArray<OutboxFreeBusyResult>,
): Effect.Effect<string> => {
	const responses = results.map((r) => ({
		"C:recipient": { "D:href": r.recipient },
		"C:request-status": r.found ? "2.0;Success" : "3.7;Invalid Calendar User",
		...(r.found ? { "C:calendar-data": r.calendarData } : {}),
	}));
	return buildXml({
		"C:schedule-response": {
			"@_xmlns:D": "DAV:",
			"@_xmlns:C": CALDAV_NS,
			"C:response": responses.length === 1 ? responses[0] : responses,
		},
	});
};

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

		// NB: the `Originator`/`Recipient` HTTP headers from the pre-standard
		// caldav-sched draft (Apple Calendar Server) are intentionally NOT
		// required. RFC 6638 derives the originator from the iCalendar ORGANIZER
		// (here, the authenticated principal) and the recipients from the
		// VFREEBUSY ATTENDEE properties — which is exactly what processOutboxPost
		// reads below. Requiring the legacy headers rejected conformant clients
		// (e.g. python-caldav) that never send them.

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
		const hasFreebusy = doc.root.components.some((c) => c.name === "VFREEBUSY");
		if (!hasFreebusy) {
			return yield* badRequest("Outbox POST requires a VFREEBUSY component");
		}

		// Delegate to SchedulingService, then render the per-recipient results
		// into a CALDAV:schedule-response (RFC 6638 §6.2.2).
		const schedulingSvc = yield* SchedulingService;
		const fbResults = yield* schedulingSvc.processOutboxPost({
			actingPrincipalId: principal.principalId,
			doc,
		});

		const xml = yield* buildScheduleResponse(fbResults);
		const bodyBytes = new TextEncoder().encode(xml);
		return new Response(bodyBytes, {
			status: HTTP_OK,
			headers: {
				"Content-Type": "application/xml; charset=utf-8",
				"Content-Length": String(bodyBytes.byteLength),
			},
		});
	});
