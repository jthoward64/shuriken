import { Effect, Either } from "effect";
import {
	type ConflictError,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	type FormValidationError,
	parseDisplayName,
	parseSlug,
	validationErrorToContext,
} from "#src/http/ui/helpers/form.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { renderFragment } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/groups/create
// ---------------------------------------------------------------------------

export const groupsCreateHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError | ConflictError,
	AclService | GroupService | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;

		yield* acl.check(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:bind",
		);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const parseResult = yield* Effect.all({
			slug: parseSlug(form.get("slug")?.toString()),
			displayName: parseDisplayName(form.get("displayName")?.toString()),
		}).pipe(Effect.either);

		if (Either.isLeft(parseResult)) {
			return yield* renderFragment("partials/form-error", {
				errors: validationErrorToContext(
					parseResult.left as FormValidationError,
				),
			});
		}
		const parsed = parseResult.right;

		const groupService = yield* GroupService;
		yield* groupService.create({
			slug: parsed.slug,
			displayName: parsed.displayName,
		});

		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": "/ui/groups" },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: "/ui/groups" },
		});
	});
