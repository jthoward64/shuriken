import { Effect } from "effect";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	applyPhotoUpload,
	parseContactForm,
} from "#src/http/ui/helpers/contact-form.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/service.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/:instanceId/update
// ---------------------------------------------------------------------------

export const contactsUpdateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | CardEditService | InstanceService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const cardEdit = yield* CardEditService;
		const instanceSvc = yield* InstanceService;

		// ACL check uses the parent collection — that's what the existing PUT
		// path does for instance writes.
		const existing = yield* instanceSvc.findById(instanceId);
		yield* acl.check(
			principal.principalId,
			CollectionId(existing.collectionId),
			"collection",
			"DAV:write-content",
		);

		const formData = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const base = parseContactForm(formData);
		if (base.fn.trim() === "") {
			return new Response("Display name is required", { status: 400 });
		}
		const withPhoto = yield* Effect.tryPromise({
			try: () => applyPhotoUpload(formData, base),
			catch: (e) => new InternalError({ cause: e }),
		});

		yield* cardEdit.update(instanceId, withPhoto);

		const redirect = `/ui/contacts?addressbook=${existing.collectionId}`;
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirect },
			});
		}
		return new Response(null, { status: 303, headers: { Location: redirect } });
	});
