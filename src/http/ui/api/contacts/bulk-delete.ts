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
// POST /ui/api/contacts/bulk-delete
//
// Deletes every selected contact. Contacts that no longer exist are skipped;
// a contact the caller may not unbind fails the whole batch (we never silently
// ignore an authorization denial).
// ---------------------------------------------------------------------------

export const contactsBulkDeleteHandler = (
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
						"DAV:unbind",
					);
					yield* cardEdit.delete(id);
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
