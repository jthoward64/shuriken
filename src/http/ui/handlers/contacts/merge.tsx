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
	ContactsMergePage,
	type MergeGroupData,
} from "#src/http/ui/view/pages/contacts/merge.tsx";
import { contactsExtraHead } from "#src/http/ui/view/pages/contacts/shared.tsx";
import { CONTACTS_ASSETS } from "#src/http/ui/view/shell/assets.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/shell/render.tsx";
import type { AclService } from "#src/services/acl/service.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";
import {
	CollectionRepository,
	type CollectionRow,
} from "#src/services/collection/repository.ts";
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

interface MergeQuery {
	readonly run: boolean;
	readonly emailChecked: boolean;
	readonly phoneChecked: boolean;
	readonly nameChecked: boolean;
	readonly criteria: ReadonlyArray<MatchCriterion>;
}

// Criteria checkboxes: email + phone default on, name off. On submit the state
// reflects exactly what was checked (absent checkbox means unchecked).
const parseMergeQuery = (params: URLSearchParams): MergeQuery => {
	const run = params.has("run");
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
	return { run, emailChecked, phoneChecked, nameChecked, criteria };
};

interface MergeScope {
	readonly value: string;
	readonly all: boolean;
	readonly collectionIds: ReadonlyArray<CollectionId>;
}

// Scope: every owned addressbook, or a single one (default: the first)
const resolveScope = (
	params: URLSearchParams,
	addressbooks: ReadonlyArray<CollectionRow>,
): MergeScope => {
	const requested = params.get("scope") ?? addressbooks[0]?.id ?? ALL_SCOPE;
	if (requested === ALL_SCOPE) {
		return {
			value: ALL_SCOPE,
			all: true,
			collectionIds: addressbooks.map((c) => CollectionId(c.id)),
		};
	}
	const selected =
		addressbooks.find((c) => c.id === requested) ?? addressbooks[0];
	return {
		value: selected?.id ?? ALL_SCOPE,
		all: false,
		collectionIds: selected === undefined ? [] : [CollectionId(selected.id)],
	};
};

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

		const query = parseMergeQuery(ctx.url.searchParams);
		const scope = resolveScope(ctx.url.searchParams, addressbooks);

		const bookName = new Map<string, string>(
			addressbooks.map((c) => [c.id, c.displayName ?? c.slug]),
		);

		let groups: ReadonlyArray<MergeGroupData> = [];
		if (
			query.run &&
			query.criteria.length > 0 &&
			scope.collectionIds.length > 0
		) {
			const rows = yield* cardIndex.listForDedup(scope.collectionIds);
			groups = findDuplicateGroups(rows, query.criteria).map((members) => ({
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
			selected: c.id === scope.value,
		}));

		// HTMX = the sidebar trigger / find submit: return just the popover fragment.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<ContactsMergePage
					scope={scope.value}
					scopeAll={scope.all}
					emailChecked={query.emailChecked}
					phoneChecked={query.phoneChecked}
					nameChecked={query.nameChecked}
					noCriteria={query.run && query.criteria.length === 0}
					run={query.run}
					addressbooks={addressbookOptions}
					groups={groups}
					groupCount={groups.length}
					showAddressbook={scope.all}
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
				scope={scope.value}
				scopeAll={scope.all}
				emailChecked={query.emailChecked}
				phoneChecked={query.phoneChecked}
				nameChecked={query.nameChecked}
				noCriteria={query.run && query.criteria.length === 0}
				run={query.run}
				addressbooks={addressbookOptions}
				groups={groups}
				groupCount={groups.length}
				showAddressbook={scope.all}
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
