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
import { ContactHoverCard } from "#src/http/ui/view/pages/contacts/hover-card.tsx";
import { ContactPreviewPane } from "#src/http/ui/view/pages/contacts/preview-pane.tsx";
import { contactsExtraHead } from "#src/http/ui/view/pages/contacts/shared.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/service.ts";
import { parseVcardToForm } from "#src/services/card-edit/parse-vcard.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/:instanceId/preview[?variant=hover]
//
// Read-only preview of a contact, rendered three ways:
//   - ?variant=hover  → the compact hover card fragment (hover on a row).
//   - HTMX request     → the full preview-pane fragment (into #contacts-pane-body).
//   - navigation       → the full standalone preview page (the no-JS new-tab
//                        fallback for the row's main click target).
// Reuses the same fetch chain as contactsEditHandler.
// ---------------------------------------------------------------------------

export const contactsPreviewHandler = (
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

		// Hover card: the compact summary shown on mouse-over.
		if (ctx.url.searchParams.get("variant") === "hover") {
			return yield* renderFragment(
				<ContactHoverCard
					form={form}
					editHref={`/ui/contacts/${instanceId}`}
				/>,
			);
		}

		// Pane fragment: swapped into the desktop split column / mobile slide-over.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<ContactPreviewPane form={form} instanceId={instanceId} />,
			);
		}

		// Full standalone page: the no-JS "open preview in a new tab" fallback.
		const config = yield* AppConfigService;
		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);
		return yield* renderPage(
			<ContactPreviewPane form={form} instanceId={instanceId} standalone />,
			{
				headers: ctx.headers,
				title: form.fn || "Contact",
				nav,
				extraHead: contactsExtraHead,
				preload: CONTACTS_ASSETS,
			},
		);
	});
