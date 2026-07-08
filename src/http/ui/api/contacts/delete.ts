import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/service.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/:instanceId/delete
//
// When trash retention is disabled (AppConfigService.trash.retentionDays ===
// 0), the contact is hard-deleted immediately instead of soft-deleted — there
// is no trash bin to recover it from in that mode.
// ---------------------------------------------------------------------------

export const contactsDeleteHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | CardEditService | InstanceService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const cardEdit = yield* CardEditService;
		const instanceSvc = yield* InstanceService;
		const config = yield* AppConfigService;

		const existing = yield* instanceSvc.findById(instanceId);
		yield* acl.check(
			principal.principalId,
			CollectionId(existing.collectionId),
			"collection",
			"DAV:unbind",
		);

		if (config.trash.retentionDays === 0) {
			yield* instanceSvc.hardDelete(instanceId);
		} else {
			yield* cardEdit.delete(instanceId);
		}

		const redirect = `/ui/contacts?addressbook=${existing.collectionId}`;
		// HTMX = the edit dialog: refresh the list + close the dialog (both driven
		// by `contacts:changed`) instead of navigating, matching update above.
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Trigger": "contacts:changed" },
			});
		}
		return new Response(null, { status: 303, headers: { Location: redirect } });
	});
