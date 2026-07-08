import { Effect, Redacted, Result } from "effect";
import {
	type ConflictError,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	type FormValidationError,
	parseDisplayName,
	parseEmail,
	parseSlug,
	validationErrorToContext,
} from "#src/http/ui/helpers/form.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { FormErrors } from "#src/http/ui/view/ui.tsx";
import { AclService } from "#src/services/acl/index.ts";
import { ProvisioningService } from "#src/services/provisioning/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/users/create
// ---------------------------------------------------------------------------

export const usersCreateHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError | ConflictError,
	AclService | ProvisioningService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;

		yield* acl.check(
			principal.principalId,
			USERS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:bind",
		);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const parseResult = yield* Effect.all({
			slug: parseSlug(form.get("slug")?.toString()),
			email: parseEmail(form.get("email")?.toString()),
			displayName: parseDisplayName(form.get("displayName")?.toString()),
		}).pipe(Effect.result);

		if (Result.isFailure(parseResult)) {
			return yield* renderFragment(
				<FormErrors
					errors={validationErrorToContext(
						parseResult.failure as FormValidationError,
					)}
				/>,
			);
		}
		const parsed = parseResult.success;

		const password = form.get("password")?.toString();
		// Use ProvisioningService rather than UserService.create directly so
		// new users get the same default collections (primary calendar,
		// primary address book, scheduling inbox/outbox) and owner-ACL grant
		// that the admin user gets at startup. Without this, alice has no
		// inbox so admin's invite has nowhere to land.
		const provisioning = yield* ProvisioningService;
		yield* provisioning.provisionUser({
			slug: parsed.slug,
			email: parsed.email,
			name: parsed.displayName ?? parsed.slug,
			credentials: password
				? [
						{
							source: "local" as const,
							authId: parsed.email,
							password: Redacted.make(password),
						},
					]
				: undefined,
		});

		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": "/ui/users" },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: "/ui/users" },
		});
	});
