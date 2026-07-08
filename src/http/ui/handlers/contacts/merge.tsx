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
import { CONTACTS_ASSETS } from "#src/http/ui/view/assets.tsx";
import {
	ContactsMergePage,
	type MergeGroupData,
} from "#src/http/ui/view/pages/contacts/merge.tsx";
import { contactsExtraHead } from "#src/http/ui/view/pages/contacts/shared.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/service.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import {
	findDuplicateGroups,
	type MatchCriterion,
} from "#src/services/contact-merge/detect.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/merge?scope=<all|addressbookId>&email&phone&name&run
//
// Renders the duplicate-finder form and, once submitted (`run`), the detected
// duplicate groups with a per-group Merge button. Detection is OR across the
// chosen criteria (see contact-merge/detect.ts).
// ---------------------------------------------------------------------------

const ALL_SCOPE = "all";

export const contactsMergeHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | CardIndexRepository | CollectionRepository
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

		const params = ctx.url.searchParams;
		const run = params.has("run");

		// Criteria checkboxes: email + phone default on, name off. On submit the
		// state reflects exactly what was checked (absent checkbox ⇒ unchecked).
		const emailChecked = run ? params.has("email") : true;
		const phoneChecked = run ? params.has("phone") : true;
		const nameChecked = run ? params.has("name") : false;
		const criteria: Array<MatchCriterion> = [];
		if (emailChecked) {
			criteria.push("email");
		}
		if (phoneChecked) {
			criteria.push("phone");
		}
		if (nameChecked) {
			criteria.push("name");
		}

		// Scope: "all" owned addressbooks, or a single one (default: the first).
		const requestedScope =
			params.get("scope") ?? addressbooks[0]?.id ?? ALL_SCOPE;
		const scopeAll = requestedScope === ALL_SCOPE;
		const selected = scopeAll
			? undefined
			: (addressbooks.find((c) => c.id === requestedScope) ?? addressbooks[0]);
		const effectiveScope = scopeAll ? ALL_SCOPE : (selected?.id ?? ALL_SCOPE);
		const collectionIds = scopeAll
			? addressbooks.map((c) => CollectionId(c.id))
			: selected
				? [CollectionId(selected.id)]
				: [];

		const bookName = new Map<string, string>(
			addressbooks.map((c) => [c.id, c.displayName ?? c.slug]),
		);

		let groups: ReadonlyArray<MergeGroupData> = [];

		if (run && criteria.length > 0 && collectionIds.length > 0) {
			const rows = yield* cardIndex.listForDedup(collectionIds);
			const found = findDuplicateGroups(rows, criteria);
			groups = found.map((members) => ({
				ids: members.map((m) => m.instanceId).join(","),
				count: members.length,
				members: members.map((m) => ({
					instanceId: m.instanceId,
					fn: m.fn || "(no name)",
					email: m.emails[0] ?? "",
					tel: m.phones[0] ?? "",
					addressbook: bookName.get(m.collectionId) ?? "",
				})),
			}));
		}

		const addressbookOptions = addressbooks.map((c) => ({
			id: c.id,
			displayName: c.displayName ?? c.slug,
			selected: c.id === effectiveScope,
		}));

		// HTMX = the sidebar trigger / find submit: return just the popover fragment.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<ContactsMergePage
					scope={effectiveScope}
					scopeAll={scopeAll}
					emailChecked={emailChecked}
					phoneChecked={phoneChecked}
					nameChecked={nameChecked}
					noCriteria={run && criteria.length === 0}
					run={run}
					addressbooks={addressbookOptions}
					groups={groups}
					groupCount={groups.length}
					showAddressbook={scopeAll}
					hasAddressbook={addressbooks.length > 0}
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
			<ContactsMergePage
				scope={effectiveScope}
				scopeAll={scopeAll}
				emailChecked={emailChecked}
				phoneChecked={phoneChecked}
				nameChecked={nameChecked}
				noCriteria={run && criteria.length === 0}
				run={run}
				addressbooks={addressbookOptions}
				groups={groups}
				groupCount={groups.length}
				showAddressbook={scopeAll}
				hasAddressbook={addressbooks.length > 0}
			/>,
			{
				headers: ctx.headers,
				title: "Merge duplicates",
				nav,
				extraHead: contactsExtraHead,
				preload: CONTACTS_ASSETS,
			},
		);
	});
