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
import {
	DEFAULT_REGION,
	REGION_OPTIONS,
} from "#src/http/ui/helpers/regions.ts";
import { CONTACTS_ASSETS } from "#src/http/ui/view/assets.tsx";
import {
	type CleanupSuggestionData,
	ContactsCleanupPage,
} from "#src/http/ui/view/pages/contacts/cleanup.tsx";
import { contactsExtraHead } from "#src/http/ui/view/pages/contacts/shared.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/service.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { ContactCleanupService } from "#src/services/contact-cleanup/service.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/cleanup?addressbook=<id>&region=<XX>
//
// Scans the selected addressbook for messy contact data and lists each problem
// as an individual Fix / Ignore suggestion. Region drives phone parsing and can
// be changed from the page (re-scans on submit).
// ---------------------------------------------------------------------------

export const contactsCleanupHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | CollectionRepository | ContactCleanupService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const collRepo = yield* CollectionRepository;
		const acl = yield* AclService;
		const cleanup = yield* ContactCleanupService;

		const all = yield* collRepo.listByOwner(principal.principalId);
		const addressbooks = all.filter(
			(c) => c.collectionType === "addressbook" && c.deletedAt === null,
		);

		const params = ctx.url.searchParams;
		const requestedId = params.get("addressbook") ?? "";
		const selected: CollectionRow | undefined =
			addressbooks.find((c) => c.id === requestedId) ?? addressbooks[0];

		const requestedRegion = params.get("region") ?? "";
		const region =
			REGION_OPTIONS.find((r) => r.code === requestedRegion)?.code ??
			DEFAULT_REGION;

		let suggestions: ReadonlyArray<CleanupSuggestionData> = [];

		if (selected) {
			yield* acl.check(
				principal.principalId,
				CollectionId(selected.id),
				"collection",
				"DAV:read",
			);
			const found = yield* cleanup.scan(CollectionId(selected.id), region);
			suggestions = found.map((s) => ({
				instanceId: s.instanceId,
				contactFn: s.contactFn,
				title: s.title,
				description: s.description,
				current: s.current,
				proposed: s.proposed,
				fix: s.fix,
				needsAreaCode: s.needsInput === "areaCode",
				needsLabel: s.needsInput === "label",
				labelOptions: s.labelOptions ?? [],
				region,
			}));
		}

		const addressbookOptions = addressbooks.map((c) => ({
			id: c.id,
			displayName: c.displayName ?? c.slug,
			selected: c.id === selected?.id,
		}));
		const regionOptions = REGION_OPTIONS.map((r) => ({
			code: r.code,
			name: r.name,
			selected: r.code === region,
		}));

		// HTMX = the sidebar trigger / rescan: return just the popover fragment.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<ContactsCleanupPage
					hasAddressbook={selected !== undefined}
					addressbooks={addressbookOptions}
					regions={regionOptions}
					suggestions={suggestions}
					suggestionCount={suggestions.length}
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
			<ContactsCleanupPage
				hasAddressbook={selected !== undefined}
				addressbooks={addressbookOptions}
				regions={regionOptions}
				suggestions={suggestions}
				suggestionCount={suggestions.length}
			/>,
			{
				headers: ctx.headers,
				title: "Clean up contacts",
				nav,
				extraHead: contactsExtraHead,
				preload: CONTACTS_ASSETS,
			},
		);
	});
