import { Effect } from "effect";
import type { InternalError } from "#src/domain/errors.ts";
import { TemplateService } from "#src/http/ui/template/index.ts";
import { isHtmxRequest } from "./htmx.ts";

// ---------------------------------------------------------------------------
// Render helpers — produce HTML Response values from template renders
// ---------------------------------------------------------------------------

export const renderPage = (
	name: string,
	ctx: Record<string, unknown>,
	headers: Headers,
): Effect.Effect<Response, InternalError, TemplateService> =>
	Effect.gen(function* () {
		const templates = yield* TemplateService;
		const html = yield* templates.render(name, ctx, isHtmxRequest(headers));
		return new Response(html, {
			status: 200,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	});

export const renderFragment = (
	name: string,
	ctx: Record<string, unknown>,
): Effect.Effect<Response, InternalError, TemplateService> =>
	Effect.gen(function* () {
		const templates = yield* TemplateService;
		const html = yield* templates.renderFragment(name, ctx);
		return new Response(html, {
			status: 200,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	});

export const renderError = (
	status: number,
	name: string,
	ctx: Record<string, unknown>,
	headers: Headers,
): Effect.Effect<Response, InternalError, TemplateService> =>
	Effect.gen(function* () {
		const templates = yield* TemplateService;
		const html = yield* templates.render(name, ctx, isHtmxRequest(headers));
		return new Response(html, {
			status,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	});
