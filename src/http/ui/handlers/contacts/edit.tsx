import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { notFound } from "#src/domain/errors.ts";
import { EntityId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { CONTACTS_ASSETS } from "#src/http/ui/view/assets.tsx";
import { EDIT_CONTACT_POPOVER_ID } from "#src/http/ui/view/pages/contacts/edit-dialog.tsx";
import { ContactFormPage } from "#src/http/ui/view/pages/contacts/form.tsx";
import { contactsExtraHead } from "#src/http/ui/view/pages/contacts/shared.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/service.ts";
import { parseVcardToForm } from "#src/services/card-edit/parse-vcard.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/<instanceId>
// ---------------------------------------------------------------------------

export const contactsEditHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | ComponentRepository | InstanceService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
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
		const title = form.fn || "Contact";

		// HTMX (the contacts page loading the edit dialog) gets just the form
		// fragment; a normal navigation gets the full standalone page (the no-JS
		// edit path, and the hover card's Edit link before JS intercepts it).
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<ContactFormPage
					pageTitle={title}
					mode="edit"
					addressbookId={instance.collectionId}
					form={form}
					action={`/ui/api/contacts/${instanceId}/update`}
					deleteAction={`/ui/api/contacts/${instanceId}/delete`}
					variant="popover"
					popoverId={EDIT_CONTACT_POPOVER_ID}
				/>,
			);
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);
		return yield* renderPage(
			<ContactFormPage
				pageTitle={title}
				mode="edit"
				addressbookId={instance.collectionId}
				form={form}
				action={`/ui/api/contacts/${instanceId}/update`}
				deleteAction={`/ui/api/contacts/${instanceId}/delete`}
			/>,
			{
				headers: ctx.headers,
				title,
				nav,
				extraHead: contactsExtraHead,
				preload: CONTACTS_ASSETS,
			},
		);
	});
