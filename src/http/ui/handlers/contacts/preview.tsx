import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { notFound } from "#src/domain/errors.ts";
import { EntityId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { ContactHoverCard } from "#src/http/ui/view/pages/contacts/hover-card.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/service.ts";
import { parseVcardToForm } from "#src/services/card-edit/parse-vcard.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/:instanceId/preview
//
// HTMX-only: the hover card fetches this on hover/click (see contacts.js).
// Read-only — reuses the same fetch chain as contactsEditHandler, just
// renders ContactHoverCard instead of the edit form.
// ---------------------------------------------------------------------------

export const contactsPreviewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ComponentRepository | InstanceService
> =>
	Effect.gen(function* () {
		yield* requireAuthenticated(ctx.auth);
		const instanceSvc = yield* InstanceService;
		const componentRepo = yield* ComponentRepository;

		const instance = yield* instanceSvc.findById(instanceId);
		const tree = yield* componentRepo.loadTree(
			EntityId(instance.entityId),
			"vcard",
		);
		if (Option.isNone(tree)) {
			return yield* Effect.fail(notFound("Contact not found"));
		}
		const form = parseVcardToForm(tree.value);
		const editHref = `/ui/contacts/${instanceId}`;

		return yield* renderFragment(
			<ContactHoverCard form={form} editHref={editHref} />,
		);
	});
