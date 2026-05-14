import { Effect } from "effect";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, isUuid } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	applyPhotoUpload,
	parseContactForm,
} from "#src/http/ui/helpers/contact-form.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/service.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/create
// ---------------------------------------------------------------------------

export const contactsCreateHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | CardEditService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const cardEdit = yield* CardEditService;

		const formData = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const addressbookRaw = formData.get("addressbookId")?.toString() ?? "";
		if (!isUuid(addressbookRaw)) {
			return new Response("Missing or invalid addressbookId", { status: 400 });
		}
		const addressbookId = CollectionId(addressbookRaw);

		yield* acl.check(
			principal.principalId,
			addressbookId,
			"collection",
			"DAV:bind",
		);

		const base = parseContactForm(formData);
		const withPhoto = yield* Effect.tryPromise({
			try: () => applyPhotoUpload(formData, base),
			catch: (e) => new InternalError({ cause: e }),
		});

		yield* cardEdit.create(addressbookId, withPhoto);

		const redirect = `/ui/contacts?addressbook=${addressbookId}`;
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirect },
			});
		}
		return new Response(null, { status: 303, headers: { Location: redirect } });
	});
