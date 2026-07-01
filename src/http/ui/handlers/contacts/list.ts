import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclService } from "#src/services/acl/service.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts?addressbook=<id>&q=<search>
// ---------------------------------------------------------------------------

interface ContactRow {
	readonly instanceId: string;
	readonly fn: string;
	readonly email: string;
	readonly tel: string;
	readonly hasPhoto: boolean;
	/** First character of the display name, for the initials placeholder. */
	readonly initial: string;
}

export const contactsListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| CardIndexRepository
	| CollectionRepository
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const collRepo = yield* CollectionRepository;
		const cardIndex = yield* CardIndexRepository;

		const all = yield* collRepo.listByOwner(principal.principalId);
		const addressbooks = all.filter(
			(c) => c.collectionType === "addressbook" && c.deletedAt === null,
		);

		const requestedId = ctx.url.searchParams.get("addressbook") ?? "";
		const selected: CollectionRow | undefined =
			addressbooks.find((c) => c.id === requestedId) ?? addressbooks[0];

		const query = (ctx.url.searchParams.get("q") ?? "").trim();

		let contacts: ReadonlyArray<ContactRow> = [];
		if (selected) {
			// Project contact rows straight out of the card_index (kept in sync by
			// a DB trigger). FN search is applied in SQL via the fold column, so
			// both the full listing and search are a single query — no per-contact
			// vCard tree reload.
			const summaries = yield* cardIndex.listForCollection(
				CollectionId(selected.id),
				query === "" ? undefined : query,
			);
			contacts = summaries
				.map((s) => {
					const fn = s.fn || "(no name)";
					const first = fn.trim().charAt(0).toUpperCase();
					return {
						instanceId: s.instanceId,
						fn,
						email: s.email ?? "",
						tel: s.tel ?? "",
						hasPhoto: s.hasPhoto,
						initial: /[A-Z0-9]/i.test(first) ? first : "?",
					};
				})
				.sort((a, b) => a.fn.localeCompare(b.fn));
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			"pages/contacts/list",
			{
				...nav,
				pageTitle: "Contacts",
				query,
				selectedId: selected?.id ?? "",
				addressbooks: addressbooks.map((c) => ({
					id: c.id,
					displayName: c.displayName ?? c.slug,
					selected: c.id === selected?.id,
				})),
				contacts,
				hasAddressbook: selected !== undefined,
			},
			ctx.headers,
		);
	});
