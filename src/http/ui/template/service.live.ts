import path from "node:path";
import { Effect, Layer } from "effect";
import Handlebars from "handlebars";
import { InternalError } from "#src/domain/errors.ts";
import { BunFileService } from "#src/platform/file.ts";
import { TemplateService } from "./service.ts";

// ---------------------------------------------------------------------------
// Template directory — resolved relative to this file at build time
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = path.resolve(import.meta.dir, "../templates");

// ---------------------------------------------------------------------------
// Helpers registration
// ---------------------------------------------------------------------------

function registerHelpers(hbs: typeof Handlebars): void {
	hbs.registerHelper("eq", (a: unknown, b: unknown) => a === b);
	hbs.registerHelper(
		"or",
		(a: unknown, b: unknown) => Boolean(a) || Boolean(b),
	);
	hbs.registerHelper(
		"and",
		(a: unknown, b: unknown) => Boolean(a) && Boolean(b),
	);
	hbs.registerHelper(
		"includes",
		(arr: unknown, val: unknown) => Array.isArray(arr) && arr.includes(val),
	);
	hbs.registerHelper("formatDate", (value: unknown) => {
		if (typeof value === "string") {
			return value;
		}
		return String(value);
	});
}

// ---------------------------------------------------------------------------
// TemplateServiceLive
// ---------------------------------------------------------------------------

export const TemplateServiceLive = Layer.effect(
	TemplateService,
	Effect.gen(function* () {
		const files = yield* BunFileService;

		// Enumerate all .hbs files under the templates directory
		const hbsPaths = yield* files.glob("**/*.hbs", TEMPLATES_DIR);

		// Create an isolated Handlebars environment
		const hbs = Handlebars.create();
		registerHelpers(hbs);

		// Compiled template cache: key is the logical name (e.g. "pages/users/list")
		const compiled = new Map<string, Handlebars.TemplateDelegate>();

		for (const relPath of hbsPaths) {
			const absPath = path.join(TEMPLATES_DIR, relPath);
			const source = yield* files.readText(absPath);
			// Logical name: strip .hbs extension
			const name = relPath.replace(/\.hbs$/, "");

			const template = hbs.compile(source);
			compiled.set(name, template);

			// Register partials (layouts/ and partials/)
			if (name.startsWith("layouts/") || name.startsWith("partials/")) {
				// Partial name: last segment, e.g. "partials/nav" → "nav", "layouts/base" → "base"
				const partialName = name.split("/").pop() ?? name;
				hbs.registerPartial(partialName, source);
			}
		}

		const getTemplate = (
			name: string,
		): Effect.Effect<Handlebars.TemplateDelegate, InternalError> => {
			const t = compiled.get(name);
			if (!t) {
				return Effect.fail(
					new InternalError({
						cause: new Error(`Template not found: ${name}`),
					}),
				);
			}
			return Effect.succeed(t);
		};

		const layout = compiled.get("layouts/base");

		return TemplateService.of({
			render: (name, ctx, isHtmx) =>
				Effect.gen(function* () {
					const template = yield* getTemplate(name);
					const body = yield* Effect.try({
						try: () => template(ctx),
						catch: (e) => new InternalError({ cause: e }),
					});
					if (isHtmx || !layout) {
						return body;
					}
					return yield* Effect.try({
						try: () => layout({ ...ctx, body }),
						catch: (e) => new InternalError({ cause: e }),
					});
				}),

			renderFragment: (name, ctx) =>
				Effect.gen(function* () {
					const template = yield* getTemplate(name);
					return yield* Effect.try({
						try: () => template(ctx),
						catch: (e) => new InternalError({ cause: e }),
					});
				}),
		});
	}),
);
