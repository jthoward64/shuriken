import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/service.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { contactsRedirect, parseBulkSelection } from "./bulk-shared.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/bulk-clear-photo
//
// Removes the PHOTO property from every selected contact (a structural edit
// that preserves all other vCard properties). Missing contacts are skipped;
// an unauthorized contact fails the batch.
// ---------------------------------------------------------------------------

export const contactsBulkClearPhotoHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | CardEditService | InstanceRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const cardEdit = yield* CardEditService;
		const instanceRepo = yield* InstanceRepository;

		const { ids, addressbook } = yield* parseBulkSelection(req);

		yield* Effect.forEach(
			ids,
			(id) =>
				Effect.gen(function* () {
					const instanceOpt = yield* instanceRepo.findById(id);
					if (Option.isNone(instanceOpt)) {
						return;
					}
					yield* acl.check(
						principal.principalId,
						CollectionId(instanceOpt.value.collectionId),
						"collection",
						"DAV:write-content",
					);
					yield* cardEdit.removePhoto(id);
				}),
			{ discard: true },
		);

		const redirect = contactsRedirect(addressbook);
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirect },
			});
		}
		return new Response(null, { status: 303, headers: { Location: redirect } });
	});
