import cssnano from "cssnano";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// ---------------------------------------------------------------------------
// Tailwind compilation — shared by the runtime CssService (startup, in-memory)
// and the `deno task ui:css` debug script. Kept framework-agnostic (a plain
// async function); the Effect wrapper lives in service.live.ts.
// ---------------------------------------------------------------------------

// A CSS custom-property backed colour. `<alpha-value>` lets Tailwind opacity
// utilities (e.g. `bg-surface/50`) keep working against the space-separated
// RGB channels the tokens store.
const token = (name: string): string => `rgb(var(--${name}) / <alpha-value>)`;

// Static indigo scale for `*-brand-*` utilities. Component classes use the
// `--brand` token directly so they can brighten in dark mode; utilities stay
// fixed, which is the expected Tailwind behaviour.
const brand = {
	"50": "#eef2ff",
	"100": "#e0e7ff",
	"200": "#c7d2fe",
	"300": "#a5b4fc",
	"400": "#818cf8",
	"500": "#6366f1",
	"600": "#4f46e5",
	"700": "#4338ca",
	"800": "#3730a3",
	"900": "#312e81",
	"950": "#1e1b4b",
};

// Design-system component classes live in `@layer components`, which Tailwind
// tree-shakes against scanned content. Safelisting guarantees the whole
// vocabulary ships even before every page adopts it.
const COMPONENT_CLASSES = [
	// Dark-mode activation classes. Toggled onto <html> at runtime, so they may
	// not appear literally in scanned templates — safelist keeps the `.dark {}`
	// token block (and any `.light` override) from being purged.
	"dark",
	"light",
	"btn",
	"btn-sm",
	"btn-lg",
	"btn-primary",
	"btn-secondary",
	"btn-danger",
	"btn-ghost",
	"link",
	"card",
	"card-pad",
	"card-header",
	"card-title",
	"page-header",
	"page-title",
	"page-subtitle",
	"page-actions",
	"form-group",
	"form-label",
	"form-hint",
	"form-input",
	"form-select",
	"form-textarea",
	"table-wrap",
	"table",
	"badge",
	"badge-brand",
	"badge-success",
	"badge-danger",
	"badge-warning",
	"menu",
	"menu-panel",
	"menu-item",
	"menu-caret",
	"menu-label",
	"menu-panel-left",
	"app-nav",
	"app-brand",
	"nav-link",
];

export interface CompileOptions {
	/** Raw contents of input.css (the `@tailwind` directives + design system). */
	readonly input: string;
	/**
	 * Absolute path to the UI root (src/http/ui). JSX views (`.tsx`) beneath it
	 * are scanned for used classes, as are `.ts` client entry files (e.g.
	 * calendar.client.ts's FullCalendar class-name-prop strings).
	 */
	readonly uiDir: string;
	/** When false, skip cssnano (faster; used for readable debug output). */
	readonly minify?: boolean;
}

export const compileCss = async ({
	input,
	uiDir,
	minify = true,
}: CompileOptions): Promise<string> => {
	// tailwindcss ships as CommonJS; under Deno npm-compat the callable is on
	// `.default`. Fall back to the namespace itself for safety.
	const tw =
		(tailwindcss as unknown as { default?: unknown }).default ?? tailwindcss;

	const config = {
		content: [`${uiDir}/**/*.{ts,tsx}`],
		darkMode: "class" as const,
		safelist: COMPONENT_CLASSES,
		theme: {
			extend: {
				colors: {
					brand,
					// Dark-mode-reactive tokens (--ink/--accent), distinct from the
					// static `brand` indigo scale above — component classes (`.btn`,
					// `.badge-brand`) already consume these via raw `rgb(var(--*))`;
					// these entries expose the same tokens as Tailwind utilities
					// (bg-ink, bg-accent/10, etc.) for class-name-prop styling (e.g.
					// FullCalendar's theming, see calendar.client.ts).
					ink: token("ink"),
					"ink-hover": token("ink-hover"),
					"ink-fg": token("ink-fg"),
					accent: token("brand"),
					"accent-hover": token("brand-hover"),
					"accent-fg": token("brand-fg"),
					canvas: token("canvas"),
					surface: token("surface"),
					"surface-2": token("surface-2"),
					line: token("line"),
					"line-strong": token("line-strong"),
					fg: token("fg"),
					muted: token("muted"),
					subtle: token("subtle"),
					ring: token("ring"),
					danger: token("danger"),
					success: token("success"),
					warning: token("warning"),
				},
			},
		},
	};

	const plugins = [
		(tw as (c: unknown) => postcss.AcceptedPlugin)(config),
		...(minify ? [cssnano({ preset: "default" })] : []),
	];

	const result = await postcss(plugins).process(input, { from: undefined });
	return result.css;
};
