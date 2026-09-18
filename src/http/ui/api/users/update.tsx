import { Effect, Option, Result } from "effect";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
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
import { FormErrors } from "#src/http/ui/view/components/form/form.tsx";
import { renderFragment } from "#src/http/ui/view/shell/render.tsx";

import { AclService } from "#src/services/acl/index.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { PrincipalService } from "#src/services/principal/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/users/:principalId/update
// ---------------------------------------------------------------------------

// Editing someone else needs write-properties, on the users directory or on that principal
const authorizeEdit = Effect.fn("ui.users.update.authorize")(function* (
	callerPrincipalId: PrincipalId,
	targetPrincipalId: PrincipalId,
) {
	const acl = yield* AclService;
	const usersVirtualPrivs = yield* acl.currentUserPrivileges(
		callerPrincipalId,
		USERS_VIRTUAL_RESOURCE_ID,
		"virtual",
	);
	if (usersVirtualPrivs.includes("DAV:write-properties")) {
		return;
	}
	yield* acl.check(
		callerPrincipalId,
		targetPrincipalId,
		"principal",
		"DAV:write-properties",
	);
});

// The submitted role, honoured only when a super_admin changes someone's current
// one. Anyone else's submission is silently ignored to keep the form failure mode
// quiet for non-priv users.
const roleChange = Effect.fn("ui.users.update.roleChange")(function* (
	callerPrincipalId: PrincipalId,
	currentRole: string,
	submitted: string | undefined,
) {
	if (submitted === undefined || submitted === currentRole) {
		return Option.none();
	}
	const aclRepo = yield* AclRepository;
	const callerRole = yield* aclRepo.getRoleForPrincipal(callerPrincipalId);
	return callerRole === "super_admin" ? Option.some(submitted) : Option.none();
});

// Renaming is a directory-level change, so it needs DAV:unbind on the users directory
const renameSlug = Effect.fn("ui.users.update.renameSlug")(function* (
	callerPrincipalId: PrincipalId,
	targetPrincipalId: PrincipalId,
	slug: Slug,
) {
	const acl = yield* AclService;
	const usersPrivs = yield* acl.currentUserPrivileges(
		callerPrincipalId,
		USERS_VIRTUAL_RESOURCE_ID,
		"virtual",
	);
	if (!usersPrivs.includes("DAV:unbind")) {
		return;
	}
	const principalService = yield* PrincipalService;
	yield* principalService.updateProperties(targetPrincipalId, {
		clientProperties: {},
		slug,
	});
});

export const usersUpdateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclRepository | AclService | PrincipalService | UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const userService = yield* UserService;
		const principalService = yield* PrincipalService;

		const { user, principal: principalRow } =
			yield* principalService.findById(principalId);
		const isSelf = user.id === principal.userId;

		if (!isSelf) {
			yield* authorizeEdit(principal.principalId, PrincipalId(principalRow.id));
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

		const nextRole = yield* roleChange(
			principal.principalId,
			user.role,
			form.get("role")?.toString(),
		);

		if (
			parsed.displayName !== (principalRow.displayName ?? undefined) ||
			parsed.email !== user.email ||
			Option.isSome(nextRole)
		) {
			yield* userService.update(UserId(user.id), {
				displayName: parsed.displayName,
				email: parsed.email,
				...(Option.isSome(nextRole) ? { role: nextRole.value } : {}),
			});
		}

		if (parsed.slug !== principalRow.slug) {
			yield* renameSlug(
				principal.principalId,
				PrincipalId(principalRow.id),
				parsed.slug as Slug,
			);
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
