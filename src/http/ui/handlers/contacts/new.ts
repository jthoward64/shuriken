import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
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
	AclService | AppConfigService | CollectionRepository | TemplateService
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
			return new Response("No addressbook available", { status: 400 });
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);
		return yield* renderPage(
			"pages/contacts/form",
			{
				...nav,
				pageTitle: "New contact",
				mode: "new",
				addressbookId: selected.id,
				form: emptyContactForm,
				action: "/ui/api/contacts/create",
			},
			ctx.headers,
		);
	});
