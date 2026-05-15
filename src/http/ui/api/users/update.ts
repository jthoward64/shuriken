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
import { AclRepository } from "#src/services/acl/repository.ts";
import { PrincipalService } from "#src/services/principal/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/users/:principalId/update
// ---------------------------------------------------------------------------

export const usersUpdateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclRepository | AclService | PrincipalService | TemplateService | UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const userService = yield* UserService;
		const principalService = yield* PrincipalService;

		const { user, principal: principalRow } =
			yield* principalService.findById(principalId);
		const isSelf = user.id === principal.userId;

		if (!isSelf) {
			const usersVirtualPrivs = yield* acl.currentUserPrivileges(
				principal.principalId,
				USERS_VIRTUAL_RESOURCE_ID,
				"virtual",
			);
			if (!usersVirtualPrivs.includes("DAV:write-properties")) {
				yield* acl.check(
					principal.principalId,
					principalRow.id as PrincipalId,
					"principal",
					"DAV:write-properties",
				);
			}
		}

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

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

		// Role edits are only honoured when the caller is super_admin.
		// Anyone else's submission of `role` is silently ignored to keep
		// the form failure mode quiet for non-priv users.
		const submittedRole = form.get("role")?.toString();
		const aclRepo = yield* AclRepository;
		const callerRole = yield* aclRepo.getRoleForPrincipal(
			principal.principalId,
		);
		const roleChange =
			submittedRole !== undefined &&
			submittedRole !== user.role &&
			callerRole === "super_admin"
				? submittedRole
				: undefined;

		if (
			parsed.displayName !== (principalRow.displayName ?? undefined) ||
			parsed.email !== user.email ||
			roleChange !== undefined
		) {
			yield* userService.update(user.id as UserId, {
				displayName: parsed.displayName,
				email: parsed.email,
				...(roleChange !== undefined ? { role: roleChange } : {}),
			});
		}

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
						slug: parsed.slug as Slug,
					},
				);
			}
		}

		const redirectTo = isSelf ? "/ui/profile" : `/ui/users/${principalId}`;
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
