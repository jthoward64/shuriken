import { Effect, Result } from "effect";
import type { AppConfigService } from "#src/config.ts";
import {
	type ConflictError,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	FormValidationError,
	parseSlug,
	validationErrorToContext,
} from "#src/http/ui/helpers/form.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { renderFragment } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { SubscriptionService } from "#src/services/external-calendar/subscription.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/subscriptions/create
//
// Form fields:
//   url               required, http(s)
//   slug              required — collection slug for the subscription
//   displayName       optional — sets claim.displaynameOverride
//   color             optional — sets claim.colorOverride
//   syncIntervalS     required, parsed as int
// ---------------------------------------------------------------------------

// Returns null on rejected values; the caller surfaces a 400 form-error
// response so the operator sees the validation message instead of a 500.
const parsePositiveInt = (value: string | undefined): number | null => {
	const n = value ? Number.parseInt(value, 10) : Number.NaN;
	if (!Number.isFinite(n) || n <= 0) {
		return null;
	}
	return n;
};

export const subscriptionsCreateHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError | ConflictError,
	| AppConfigService
	| CollectionService
	| ExternalCalendarRepository
	| SubscriptionService
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const subs = yield* SubscriptionService;

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const url = form.get("url")?.toString().trim() ?? "";
		const displayName = form.get("displayName")?.toString().trim() || undefined;
		const color = form.get("color")?.toString().trim() || undefined;

		const parseResult = yield* parseSlug(form.get("slug")?.toString()).pipe(
			Effect.result,
		);
		if (Result.isFailure(parseResult)) {
			return yield* renderFragment("partials/form-error", {
				errors: validationErrorToContext(
					parseResult.failure as FormValidationError,
				),
			});
		}
		const slug = parseResult.success;

		const syncIntervalS = parsePositiveInt(
			form.get("syncIntervalS")?.toString(),
		);

		if (!url) {
			return yield* renderFragment("partials/form-error", {
				errors: validationErrorToContext(
					new FormValidationError({
						fields: new Map([["url", "URL is required"]]),
					}),
				),
			});
		}

		if (syncIntervalS === null) {
			return yield* renderFragment("partials/form-error", {
				errors: validationErrorToContext(
					new FormValidationError({
						fields: new Map([
							["syncIntervalS", "Sync interval must be a positive integer."],
						]),
					}),
				),
			});
		}

		yield* subs.subscribe({
			principalId: principal.principalId,
			url,
			slug,
			syncIntervalS,
			...(displayName !== undefined
				? { displaynameOverride: displayName }
				: {}),
			...(color !== undefined ? { colorOverride: color } : {}),
		});

		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": "/ui/subscriptions" },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: "/ui/subscriptions" },
		});
	});
