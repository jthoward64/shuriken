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
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import type { UiPageOpts } from "#src/http/ui/helpers/page-opts.ts";
import { listOwnedAndShared } from "#src/http/ui/helpers/shared-collections.ts";
import {
	notModifiedPageResponse,
	PageCacheService,
	pageEtag,
	withPageCacheHeaders,
} from "#src/http/ui/page-cache/index.ts";
import { CONTACTS_ASSETS } from "#src/http/ui/view/assets.tsx";
import {
	type ContactRow,
	ContactsListPage,
	type ImportNotice,
} from "#src/http/ui/view/pages/contacts/list.tsx";
import { contactsExtraHead } from "#src/http/ui/view/pages/contacts/shared.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
import type { AclRepository } from "#src/services/acl/repository.ts";
import type { AclService } from "#src/services/acl/service.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { PrincipalRepository } from "#src/services/principal/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts?addressbook=<id>&q=<search>
// ---------------------------------------------------------------------------

const DECIMAL = 10;

const PAGE_SIZE = 50;

// Parse the post-redirect import summary (shown to no-JS users who submitted
// the import form with a full-page POST). Absent when no counters are present.
const parseNotice = (params: URLSearchParams): ImportNotice | undefined => {
	const keys = ["imported", "skipped", "merged", "conflicts"] as const;
	if (!keys.some((k) => params.has(k))) {
		return undefined;
	}
	const num = (k: string): number => {
		const raw = Number.parseInt(params.get(k) ?? "", DECIMAL);
		return Number.isFinite(raw) && raw > 0 ? raw : 0;
	};
	return {
		imported: num("imported"),
		skipped: num("skipped"),
		merged: num("merged"),
		conflicts: num("conflicts"),
	};
};

export const contactsListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	opts: UiPageOpts = {},
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclRepository
	| AclService
	| AppConfigService
	| CardIndexRepository
	| CollectionRepository
	| PageCacheService
	| PrincipalRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const cardIndex = yield* CardIndexRepository;

		const withSharing = yield* listOwnedAndShared(principal, "addressbook");
		const addressbooks = withSharing.map((c) => c.row);
		const sharingById = new Map(withSharing.map((c) => [c.row.id, c]));

		const requestedId = ctx.url.searchParams.get("addressbook") ?? "";
		const selected =
			addressbooks.find((c) => c.id === requestedId) ?? addressbooks[0];
		// Individually-shared contacts (instance-level ACL grants without sharing
		// the whole address book) are out of scope for this pass — no synthetic
		// pseudo-addressbook equivalent to the calendar's "Shared events" entry.
		const selectedWritable = selected
			? (sharingById.get(selected.id)?.writable ?? true)
			: true;

		const query = (ctx.url.searchParams.get("q") ?? "").trim();
		const fnFilter = query === "" ? undefined : query;
		const notice = parseNotice(ctx.url.searchParams);

		// Conditional GET — skip the countForCollection/listForCollection queries
		// below entirely when nothing the render depends on changed since the
		// client's cached copy (collection set incl. synctoken, plus this
		// request's own params).
		const pageCache = yield* PageCacheService;
		const etag = yield* pageEtag(pageCache.startupToken, {
			page: "contacts",
			principal: principal.principalId,
			fragment: isHtmxRequest(ctx.headers),
			chrome: opts.chrome ?? "full",
			addressbook: requestedId,
			q: fnFilter ?? null,
			pageParam: ctx.url.searchParams.get("page"),
			notice,
			collections: withSharing.map((c) => [
				c.row.id,
				c.row.synctoken,
				c.row.updatedAt?.toString() ?? null,
				c.row.sortOrder,
				c.writable,
			]),
		});
		const notModified = notModifiedPageResponse(ctx.headers, etag);
		if (notModified !== undefined) {
			return notModified;
		}

		let contacts: ReadonlyArray<ContactRow> = [];
		let totalPages = 1;
		let page = 1;
		if (selected) {
			const collectionId = CollectionId(selected.id);
			const total = yield* cardIndex.countForCollection(collectionId, fnFilter);
			totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

			const requestedPage = Number.parseInt(
				ctx.url.searchParams.get("page") ?? "",
				DECIMAL,
			);
			page = Number.isFinite(requestedPage)
				? Math.min(Math.max(requestedPage, 1), totalPages)
				: 1;

			// Project contact rows straight out of the card_index (kept in sync by
			// a DB trigger). FN search is applied in SQL via the fold column, so
			// both the full listing and search are a single query — no per-contact
			// vCard tree reload. Ordering + pagination happen in SQL.
			const summaries = yield* cardIndex.listForCollection(
				collectionId,
				fnFilter,
				{ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
			);
			contacts = summaries.map((s) => {
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
			});
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		const response = yield* renderPage(
			<ContactsListPage
				addressbooks={addressbooks.map((c) => ({
					id: c.id,
					displayName: c.displayName ?? c.slug,
					selected: c.id === selected?.id,
					ownerSlug: sharingById.get(c.id)?.ownerSlug ?? null,
					writable: sharingById.get(c.id)?.writable ?? true,
				}))}
				selectedId={selected?.id ?? ""}
				query={query}
				hasAddressbook={selected !== undefined}
				selectedWritable={selectedWritable}
				contacts={contacts}
				page={page}
				totalPages={totalPages}
				notice={notice}
			/>,
			{
				headers: ctx.headers,
				title: "Contacts",
				nav,
				wide: true,
				fill: true,
				chrome: opts.chrome,
				extraHead: contactsExtraHead,
				preload: CONTACTS_ASSETS,
			},
		);
		return withPageCacheHeaders(response, etag);
	});
