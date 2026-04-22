import { Effect, Either, Redacted } from "effect";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	type FormValidationError,
	parsePassword,
	validationErrorToContext,
} from "#src/http/ui/helpers/form.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { renderFragment } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/users/:slug/set-password
// ---------------------------------------------------------------------------

export const usersSetPasswordHandler = (
	req: Request,
	ctx: HttpRequestContext,
	slug: Slug,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | TemplateService | UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const userService = yield* UserService;

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

		const passwordResult = yield* parsePassword(
			form.get("newPassword")?.toString(),
		).pipe(Effect.either);

		if (Either.isLeft(passwordResult)) {
			return yield* renderFragment("partials/form-error", {
				errors: validationErrorToContext(
					passwordResult.left as FormValidationError,
				),
			});
		}
		const newPassword = passwordResult.right;

		yield* userService.setCredential(user.id as UserId, {
			source: "local",
			authId: user.email,
			password: Redacted.make(newPassword),
		});

		const redirectTo = isSelf ? "/ui/profile" : `/ui/users/${principalRow.slug}`;
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
