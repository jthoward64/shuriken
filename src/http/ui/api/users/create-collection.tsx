import { Effect, Result } from "effect";
import {
	type ConflictError,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { sanitizeReturnTo } from "#src/http/ui/handlers/auth/helpers.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	type FormValidationError,
	parseOptionalDisplayName,
	parseSlug,
	validationErrorToContext,
} from "#src/http/ui/helpers/form.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { FormErrors } from "#src/http/ui/view/ui.tsx";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import type { CollectionType } from "#src/services/collection/repository.ts";
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
	AclService | CollectionService | PrincipalService
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
		if (
			collectionTypeRaw !== "calendar" &&
			collectionTypeRaw !== "addressbook"
		) {
			return yield* renderFragment(
				<FormErrors
					errors={{
						collectionType: "Collection type must be calendar or addressbook",
					}}
				/>,
			);
		}
		const collectionType = collectionTypeRaw as CollectionType;

		const parseResult = yield* Effect.all({
			slug: parseSlug(form.get("slug")?.toString()),
			displayName: parseOptionalDisplayName(
				form.get("displayName")?.toString(),
			),
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

		const newCollection = yield* collectionService.create({
			ownerPrincipalId: principalId,
			collectionType,
			slug: parsed.slug,
			displayName: parsed.displayName,
			supportedComponents: SUPPORTED_COMPONENTS[collectionType],
		});

		// The Add-calendar popover passes returnTo=/ui/calendar so it lands back on
		// the calendar (with the new calendar visible); default is the edit page.
		const returnTo = sanitizeReturnTo(
			form.get("returnTo")?.toString() ?? null,
			`/ui/collections/${newCollection.id}`,
		);
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": returnTo },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: returnTo },
		});
	});
