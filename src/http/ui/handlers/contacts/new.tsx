import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_BAD_REQUEST } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { CONTACTS_ASSETS } from "#src/http/ui/view/assets.tsx";
import { ContactFormPage } from "#src/http/ui/view/pages/contacts/form.tsx";
import { contactsExtraHead } from "#src/http/ui/view/pages/contacts/shared.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/service.ts";
import { emptyContactForm } from "#src/services/card-edit/types.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/new?addressbook=<id>
// ---------------------------------------------------------------------------

export const contactsNewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | CollectionRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const collRepo = yield* CollectionRepository;

		const all = yield* collRepo.listByOwner(principal.principalId);
		const addressbooks = all.filter(
			(c) => c.collectionType === "addressbook" && c.deletedAt === null,
		);
		const requestedId = ctx.url.searchParams.get("addressbook") ?? "";
		const selected =
			addressbooks.find((c) => c.id === requestedId) ?? addressbooks[0];
		if (!selected) {
			return new Response("No addressbook available", {
				status: HTTP_BAD_REQUEST,
			});
		}

		// HTMX = the sidebar trigger: return just the popover fragment. No-JS
		// follows the link to the full page.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<ContactFormPage
					pageTitle="New contact"
					mode="new"
					addressbookId={selected.id}
					form={emptyContactForm}
					action="/ui/api/contacts/create"
					variant="popover"
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
				pageTitle="New contact"
				mode="new"
				addressbookId={selected.id}
				form={emptyContactForm}
				action="/ui/api/contacts/create"
			/>,
			{
				headers: ctx.headers,
				title: "New contact",
				nav,
				extraHead: contactsExtraHead,
				preload: CONTACTS_ASSETS,
			},
		);
	});
