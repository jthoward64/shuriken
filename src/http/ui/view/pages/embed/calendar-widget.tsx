import type { VNode } from "preact";

// ---------------------------------------------------------------------------
// EmbedCalendarWidgetPage — the public, unauthenticated /embed/<token> page.
//
// Deliberately NOT routed through Layout/renderPage: this is a bare HTML
// document meant to be iframed by a third party, so it carries no app-nav
// chrome, no session cookie, no htmx. FullCalendar is inlined into
// embed-widget.js by Deno.bundle() (see client/embed-widget.client.ts), a
// small dedicated boot script separate from calendar.js, which assumes an
// authenticated, writable calendar.
// ---------------------------------------------------------------------------

export type EmbedWidgetView = "month" | "week" | "list";
export type EmbedWidgetTheme = "light" | "dark" | "auto";

const FC_VIEW: Record<EmbedWidgetView, string> = {
	month: "dayGridMonth",
	week: "timeGridWeek",
	list: "listMonth",
};

export interface EmbedCalendarWidgetPageProps {
	readonly title: string;
	readonly view: EmbedWidgetView;
	readonly theme: EmbedWidgetTheme;
	/** Same-origin JSON events endpoint (see http/embed/events.ts). */
	readonly eventsUrl: string;
}

export const EmbedCalendarWidgetPage = ({
	title,
	view,
	theme,
	eventsUrl,
}: EmbedCalendarWidgetPageProps): VNode => (
	<html lang="en" class={theme === "auto" ? undefined : theme}>
		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<meta name="color-scheme" content="light dark" />
			<meta name="robots" content="noindex, nofollow" />
			<title>{title}</title>
			<link rel="stylesheet" href="/static/app.css" />
			<link rel="stylesheet" href="/static/embed-widget.css" />
			<script src="/static/embed-widget.js" defer />
		</head>
		<body class="min-h-screen bg-surface p-2">
			<div
				id="fullcalendar-embed"
				data-initial-view={FC_VIEW[view]}
				data-events-url={eventsUrl}
				class="h-full min-h-[480px]"
			/>
		</body>
	</html>
);
