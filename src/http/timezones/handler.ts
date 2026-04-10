// ---------------------------------------------------------------------------
// RFC 7808 timezone distribution service — GET /timezones
//
// Provides VTIMEZONE component data for IANA timezones, enabling RFC 7809
// "timezones by reference" operation. Clients use this endpoint to fetch
// timezone definitions rather than embedding them in every iCalendar object.
//
// Supported actions:
//   capabilities — service capabilities document (JSON)
//   list         — list of all available timezone IDs with ETags (JSON)
//   get          — fetch a single VTIMEZONE component (text/calendar)
//
// References: RFC 7808 §4 (actions), RFC 7809 §3.1.2 (server requirements)
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";
import { IanaTimezoneService } from "#src/services/timezone/index.ts";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const jsonResponse = (
	body: unknown,
	status = 200,
): Effect.Effect<Response, never> =>
	Effect.succeed(
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		}),
	);

const badRequest = (message: string): Effect.Effect<Response, never> =>
	jsonResponse({ error: message }, 400);

const notFound = (): Effect.Effect<Response, never> =>
	jsonResponse({ error: "Timezone not found" }, 404);

// ---------------------------------------------------------------------------
// Action: capabilities
// ---------------------------------------------------------------------------

const handleCapabilities = (
	origin: string,
): Effect.Effect<Response, never> =>
	jsonResponse({
		info: { "primary-source": `${origin}/timezones` },
		actions: ["capabilities", "list", "get"],
	});

// ---------------------------------------------------------------------------
// Action: list
// ---------------------------------------------------------------------------

/**
 * Extract LAST-MODIFIED timestamp from a VTIMEZONE component text.
 * Returns null if not present.
 */
const extractLastModified = (vtimezone: string): string | null => {
	const match = /^LAST-MODIFIED:(\S+)/m.exec(vtimezone);
	return match?.[1] ?? null;
};

const handleList = (): Effect.Effect<
	Response,
	never,
	IanaTimezoneService
> =>
	Effect.gen(function* () {
		const svc = yield* IanaTimezoneService;
		const tzids = svc.listTzids();

		const timezones = tzids.map((tzid) => {
			const vtOpt = svc.getVtimezone(tzid);
			const lastModified = Option.match(vtOpt, {
				onSome: (vt) => extractLastModified(vt),
				onNone: () => null,
			});
			return {
				tzid,
				...(lastModified ? { "last-modified": lastModified } : {}),
				etag: `"${tzid}"`,
			};
		});

		return yield* jsonResponse({ timezones });
	});

// ---------------------------------------------------------------------------
// Action: get
// ---------------------------------------------------------------------------

/**
 * Wrap a bare VTIMEZONE component in a minimal VCALENDAR envelope for
 * RFC 7808 §4.5 compliance (responses must be valid iCalendar objects).
 */
const wrapInVcalendar = (vtimezone: string): string =>
	`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//shuriken-ts//RFC 7808 Timezone Service//EN\r\n${vtimezone}\r\nEND:VCALENDAR\r\n`;

const handleGet = (
	tzid: string,
): Effect.Effect<Response, DatabaseError, IanaTimezoneService | CalTimezoneRepository> =>
	Effect.gen(function* () {
		const svc = yield* IanaTimezoneService;

		// Prefer the library's pre-compiled data for IANA timezones.
		const ianaOpt = svc.getVtimezone(tzid);
		if (Option.isSome(ianaOpt)) {
			const body = wrapInVcalendar(Option.getOrThrow(ianaOpt));
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/calendar; charset=utf-8" },
			});
		}

		// Fall back to cal_timezone table for custom / non-IANA timezones.
		const repo = yield* CalTimezoneRepository;
		const customOpt = yield* repo.findByTzid(tzid);
		if (Option.isSome(customOpt)) {
			const { vtimezoneData } = Option.getOrThrow(customOpt);
			const body = wrapInVcalendar(vtimezoneData);
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/calendar; charset=utf-8" },
			});
		}

		return yield* notFound();
	});

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle GET /timezones requests.
 *
 * Only GET is supported; all other methods receive 405.
 */
export const timezonesHandler = (
	req: Request,
	url: URL,
): Effect.Effect<
	Response,
	never,
	IanaTimezoneService | CalTimezoneRepository
> => {
	if (req.method !== "GET" && req.method !== "HEAD") {
		return Effect.succeed(
			new Response(null, {
				status: 405,
				headers: { Allow: "GET, HEAD" },
			}),
		);
	}

	const action = url.searchParams.get("action") ?? "capabilities";
	const origin = url.origin;

	switch (action) {
		case "capabilities":
			return handleCapabilities(origin);

		case "list":
			return handleList();

		case "get": {
			const tzid = url.searchParams.get("tzid");
			if (!tzid) {
				return badRequest("Missing required parameter: tzid");
			}
			return handleGet(tzid).pipe(
				Effect.catchTag("DatabaseError", () => notFound()),
			);
		}

		default:
			return badRequest(`Unknown action: ${action}`);
	}
};
