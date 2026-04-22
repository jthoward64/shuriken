import { Effect, Either } from "effect";
import {
	type ConflictError,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { CollectionType } from "#src/services/collection/repository.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	type FormValidationError,
	parseOptionalDisplayName,
	parseSlug,
	validationErrorToContext,
} from "#src/http/ui/helpers/form.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { renderFragment } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/users/:principalId/collections/create
// ---------------------------------------------------------------------------

const SUPPORTED_COMPONENTS: Record<string, Array<string>> = {
	calendar: ["VEVENT", "VTODO", "VJOURNAL"],
	addressbook: ["VCARD"],
};

export const usersCollectionsCreateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError | ConflictError,
	AclService | CollectionService | PrincipalService | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const principalService = yield* PrincipalService;
		const collectionService = yield* CollectionService;

		const { user } = yield* principalService.findById(principalId);

		const isSelf = user.id === principal.userId;
		if (!isSelf) {
			yield* acl.check(
				principal.principalId,
				USERS_VIRTUAL_RESOURCE_ID,
				"virtual",
				"DAV:bind",
			);
		}

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const collectionTypeRaw = form.get("collectionType")?.toString();
		if (collectionTypeRaw !== "calendar" && collectionTypeRaw !== "addressbook") {
			return yield* renderFragment("partials/form-error", {
				errors: { collectionType: "Collection type must be calendar or addressbook" },
			});
		}
		const collectionType = collectionTypeRaw as CollectionType;

		const parseResult = yield* Effect.all({
			slug: parseSlug(form.get("slug")?.toString()),
			displayName: parseOptionalDisplayName(form.get("displayName")?.toString()),
		}).pipe(Effect.either);

		if (Either.isLeft(parseResult)) {
			return yield* renderFragment("partials/form-error", {
				errors: validationErrorToContext(parseResult.left as FormValidationError),
			});
		}
		const parsed = parseResult.right;

		const newCollection = yield* collectionService.create({
			ownerPrincipalId: principalId,
			collectionType,
			slug: parsed.slug,
			displayName: parsed.displayName,
			supportedComponents: SUPPORTED_COMPONENTS[collectionType],
		});

		const redirectTo = `/ui/collections/${newCollection.id}`;
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
