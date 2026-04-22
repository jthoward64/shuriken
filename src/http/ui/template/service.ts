import { Context } from "effect";
import type { Effect } from "effect";
import type { InternalError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// TemplateService — Handlebars rendering behind an Effect interface
// ---------------------------------------------------------------------------

export interface TemplateServiceShape {
	/**
	 * Render a full page template wrapped in the base layout.
	 * HTMX requests skip the layout and return only the page fragment.
	 */
	readonly render: (
		name: string,
		ctx: Record<string, unknown>,
		isHtmx: boolean,
	) => Effect.Effect<string, InternalError>;

	/** Render a partial/fragment without any layout wrapping. */
	readonly renderFragment: (
		name: string,
		ctx: Record<string, unknown>,
	) => Effect.Effect<string, InternalError>;
}

export class TemplateService extends Context.Tag("TemplateService")<
	TemplateService,
	TemplateServiceShape
>() {}
