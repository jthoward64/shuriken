import { Effect, Either } from "effect";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	type FormValidationError,
	parseEmail,
	parseOptionalDisplayName,
	parseSlug,
	validationErrorToContext,
} from "#src/http/ui/helpers/form.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { renderFragment } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/users/:slug/update
// ---------------------------------------------------------------------------

export const usersUpdateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	slug: Slug,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | PrincipalService | TemplateService | UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const userService = yield* UserService;
		const principalService = yield* PrincipalService;

		const { user, principal: principalRow } =
			yield* userService.findBySlug(slug);
		const isSelf = user.id === principal.userId;

		if (!isSelf) {
			yield* acl.check(
				principal.principalId,
				principalRow.id as PrincipalId,
				"principal",
				"DAV:write-properties",
			);
		}

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		// Slug is optional in the form — only present when canEditSlug is true.
		// If absent, fall back to the current slug so no change is attempted.
		const slugRaw = form.get("slug")?.toString() ?? principalRow.slug;
		const parseResult = yield* Effect.all({
			displayName: parseOptionalDisplayName(
				form.get("displayName")?.toString(),
			),
			email: parseEmail(form.get("email")?.toString()),
			slug: parseSlug(slugRaw),
		}).pipe(Effect.either);

		if (Either.isLeft(parseResult)) {
			return yield* renderFragment("partials/form-error", {
				errors: validationErrorToContext(
					parseResult.left as FormValidationError,
				),
			});
		}
		const parsed = parseResult.right;

		// Apply each change if it differs from the current value
		if (
			parsed.displayName !== (principalRow.displayName ?? undefined) ||
			parsed.email !== user.email
		) {
			yield* userService.update(user.id as UserId, {
				displayName: parsed.displayName,
				email: parsed.email,
			});
		}

		// Slug change: requires DAV:unbind on the users virtual resource
		if (parsed.slug !== principalRow.slug) {
			const usersPrivs = yield* acl.currentUserPrivileges(
				principal.principalId,
				USERS_VIRTUAL_RESOURCE_ID,
				"virtual",
			);
			if (usersPrivs.includes("DAV:unbind")) {
				yield* principalService.updateProperties(
					principalRow.id as PrincipalId,
					{
						clientProperties: {},
						slug: parsed.slug,
					},
				);
			}
		}

		const redirectTo = isSelf ? "/ui/profile" : `/ui/users/${parsed.slug}`;
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirectTo },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: redirectTo },
		});
	});
