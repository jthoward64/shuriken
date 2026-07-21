import type { ComponentChildren, VNode } from "preact";
import type { NavContext } from "#src/http/ui/helpers/nav-context.ts";
import { cx } from "./cx.ts";
import { IconMoon, IconSun } from "./icons.tsx";
import { Nav } from "./nav.tsx";

// ---------------------------------------------------------------------------
// Base document layout — the app shell (chrome) wrapping every full-page render.
// HTMX requests skip this and render just the page content (see render.tsx).
//
// Theme handling + dropdown enhancement live in /static/ui.js, loaded
// render-blocking in <head> so the persisted/system theme is applied before
// first paint (no flash). No-JS users fall back to prefers-color-scheme.
// ---------------------------------------------------------------------------

const ThemeToggle = () => (
	<button
		type="button"
		data-theme-toggle
		class="nav-link"
		aria-label="Toggle dark mode"
		title="Toggle dark mode"
	>
		<IconMoon class="theme-icon-light w-5 h-5" />
		<IconSun class="theme-icon-dark w-5 h-5" />
	</button>
);

export interface LayoutProps {
	readonly title: string;
	readonly nav?: NavContext;
	readonly extraHead?: ComponentChildren;
	/** Let the main content span the full viewport width instead of the centered
	 * max-w-7xl column (used by the calendar/contacts sidebar layouts). */
	readonly wide?: boolean;
	/** Lock the shell to the viewport height on lg+ (header/footer fixed, main
	 * fills the rest with internal scroll) so the page doesn't scroll. Small
	 * screens keep normal document flow. */
	readonly fill?: boolean;
	/** "embed" suppresses the top app-nav bar (brand/nav links/theme toggle/
	 * profile/logout) for chrome-less rendering inside an iframe. The rest of
	 * the shell (html/head, main) is unchanged. Defaults to "full". */
	readonly chrome?: "full" | "embed";
	readonly children: ComponentChildren;
}

export const Layout = ({
	title,
	nav,
	extraHead,
	wide = false,
	fill = false,
	chrome = "full",
	children,
}: LayoutProps): VNode => (
	<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<meta name="color-scheme" content="light dark" />
			<meta name="theme-color" content="#4f46e5" />
			<link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
			<link
				rel="icon"
				type="image/png"
				sizes="32x32"
				href="/static/favicon-32x32.png"
			/>
			<link
				rel="icon"
				type="image/png"
				sizes="16x16"
				href="/static/favicon-16x16.png"
			/>
			<link
				rel="apple-touch-icon"
				sizes="180x180"
				href="/static/favicon-180x180.png"
			/>
			<link rel="manifest" href="/static/manifest.json" />
			<title>{`${title} — Shuriken`}</title>
			{/* These three are the BASE_ASSETS (assets.tsx) — kept explicit here
			    because their load semantics differ (app.css + render-blocking
			    ui.js vs. deferred htmx). Keep the URLs in sync with BASE_ASSETS,
			    which mirrors them for the `Link: rel=preload` header. */}
			<link rel="stylesheet" href="/static/app.css" />
			{/* Render-blocking: applies the theme before first paint. */}
			<script src="/static/ui.js" />
			{/* htmx 4 config, read at init from this meta tag. Restores the
			    htmx-2 semantics this app relies on: no swapping of 4xx/5xx
			    error responses, and no request timeout (long imports/uploads
			    must not be cut at 60s). implicitInheritance stays off (the
			    default) — a container's hx-trigger was silently inherited by
			    unrelated hx-post descendants (contacts bulk-toolbar buttons),
			    firing their hx-confirm dialogs whenever the container's own
			    trigger event fired. */}
			<meta
				name="htmx-config"
				content='{"noSwap":[204,304,"4xx","5xx"],"defaultTimeout":0}'
			/>
			{/* Self-hosted htmx (vendored in static/vendor/) — same-origin so it
			    preloads cleanly and drops the third-party CDN dependency. */}
			<script src="/static/vendor/htmx.min.js" defer />
			{extraHead}
		</head>
		<body
			class={cx(
				"min-h-screen flex flex-col",
				fill && "lg:h-dvh lg:min-h-0 lg:overflow-hidden",
			)}
		>
			<a
				href="#main"
				class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 btn btn-primary"
			>
				Skip to content
			</a>
			{chrome === "full" && (
				<header class="app-nav">
					<div class="max-w-7xl mx-auto px-4">
						<div class="flex items-center justify-between h-14 gap-4">
							<div class="flex items-center gap-2">
								<a href="/ui/calendar" class="app-brand mr-2">
									Shuriken
								</a>
								{nav && (
									<nav
										aria-label="Primary"
										class="hidden md:flex items-center gap-1"
									>
										<Nav nav={nav} />
									</nav>
								)}
							</div>
							<div class="flex items-center gap-1">
								<ThemeToggle />
								{nav?.displayName && (
									<a
										href="/ui/profile"
										class={cx(
											"nav-link",
											nav.activeSection === "profile" && "is-active",
										)}
									>
										{nav.displayName}
									</a>
								)}
								{nav?.showLogout && (
									<a href="/ui/logout" class="nav-link">
										Sign out
									</a>
								)}
							</div>
						</div>
						{nav && (
							<nav
								aria-label="Primary"
								class="md:hidden flex items-center gap-1 flex-wrap pb-2"
							>
								<Nav nav={nav} />
							</nav>
						)}
					</div>
				</header>
			)}

			<main
				id="main"
				class={cx(
					"flex-1 w-full",
					// Wide pages (calendar/contacts/tasks) go edge-to-edge and manage
					// their own insets; everything else gets the centered padded column.
					wide ? "max-w-none" : "mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8",
					fill && "lg:min-h-0 lg:overflow-hidden",
				)}
			>
				{children}
			</main>
		</body>
	</html>
);
