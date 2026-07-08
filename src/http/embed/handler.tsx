import { Effect, Option } from "effect";
import { render } from "preact-render-to-string";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import {
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_NOT_FOUND,
	HTTP_OK,
} from "#src/http/status.ts";
import {
	EmbedCalendarWidgetPage,
	type EmbedWidgetTheme,
	type EmbedWidgetView,
} from "#src/http/ui/view/pages/embed/calendar-widget.tsx";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import type { ShareLinkCalendarRow } from "#src/services/share-link/repository.ts";
import {
	ShareLinkService,
	type ShareLinkSummary,
} from "#src/services/share-link/service.ts";
import { embedCalendarEventsHandler } from "./events.ts";

// ---------------------------------------------------------------------------
// embedHandler — `GET /embed/<token>` (widget HTML) and
// `GET /embed/<token>/events` (its JSON event data).
//
// Public, unauthenticated, gated by EMBED_CALENDAR_WIDGET_ENABLED (checked by
// the caller, src/http/router.ts, alongside isEmbedPath — mirrors the /feed/
// precedent). A share link's calendars additionally opt in individually via
// `embed_enabled` (default off); a link with none opted in 404s here even if
// the link itself is active and has a working .ics feed.
// ---------------------------------------------------------------------------

const NOT_FOUND_RESPONSE = (): Response =>
	new Response("Not Found", { status: HTTP_NOT_FOUND });

const VIEWS: ReadonlySet<string> = new Set(["month", "week", "list"]);
const THEMES: ReadonlySet<string> = new Set(["light", "dark", "auto"]);

const parseView = (raw: string | null): EmbedWidgetView =>
	raw !== null && VIEWS.has(raw) ? (raw as EmbedWidgetView) : "month";

const parseTheme = (raw: string | null): EmbedWidgetTheme =>
	raw !== null && THEMES.has(raw) ? (raw as EmbedWidgetTheme) : "auto";

const embeddableCalendars = (
	summary: ShareLinkSummary,
): ReadonlyArray<ShareLinkCalendarRow> =>
	summary.calendars.filter((c) => c.embedEnabled);

export const embedHandler = (
	req: Request,
	url: URL,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| ShareLinkService
	| CalIndexRepository
	| ComponentRepository
	| InstanceRepository
> =>
	Effect.gen(function* () {
		if (req.method !== "GET" && req.method !== "HEAD") {
			return new Response("Method Not Allowed", {
				status: HTTP_METHOD_NOT_ALLOWED,
				headers: { Allow: "GET, HEAD" },
			});
		}

		// Expect /embed/<token> or /embed/<token>/events
		const match = url.pathname.match(/^\/embed\/([^/]+?)(\/events)?$/);
		if (match === null) {
			return NOT_FOUND_RESPONSE();
		}
		const rawToken = match[1];
		if (rawToken === undefined || rawToken.length === 0) {
			return NOT_FOUND_RESPONSE();
		}
		const token = decodeURIComponent(rawToken);
		const isEventsRequest = match[2] !== undefined;

		const svc = yield* ShareLinkService;
		const summaryOpt = yield* svc.getActiveByToken(token);
		if (Option.isNone(summaryOpt)) {
			return NOT_FOUND_RESPONSE();
		}
		const embeddable = embeddableCalendars(summaryOpt.value);
		if (embeddable.length === 0) {
			return NOT_FOUND_RESPONSE();
		}

		if (isEventsRequest) {
			return yield* embedCalendarEventsHandler(url, embeddable);
		}

		const view = parseView(url.searchParams.get("view"));
		const theme = parseTheme(url.searchParams.get("theme"));
		const title = summaryOpt.value.link.displayName ?? "Calendar";
		const html = yield* Effect.try({
			try: () =>
				render(
					<EmbedCalendarWidgetPage
						title={title}
						view={view}
						theme={theme}
						eventsUrl={`${url.pathname}/events`}
					/>,
				),
			catch: (cause) => new InternalError({ cause }),
		});
		return new Response(`<!DOCTYPE html>${html}`, {
			status: HTTP_OK,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	});

export const isEmbedPath = (pathname: string): boolean =>
	pathname.startsWith("/embed/");
