import { Effect, Option } from "effect";
import type { VNode } from "preact";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { Email } from "#src/domain/types/strings.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { renderFragment } from "#src/http/ui/view/shell/render.tsx";
import type { ResourceType } from "#src/services/acl/index.ts";
import { type AclResourceId, AclService } from "#src/services/acl/service.ts";
import { PrincipalService } from "#src/services/principal/index.ts";
import type { PrincipalWithUser } from "#src/services/principal/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/api/principals/search?principalSlug=&resourceType=&resourceId= —
// populates the Share picker's <datalist> as the user types (hx-trigger=
// "keyup changed delay:250ms"; HTMX serializes the triggering input's own
// name=value pair, which is "principalSlug" — see share-panel.tsx). Applies
// SharingConfig.userSearchMode:
//   - admin_only  — empty result for non-admins, no query run.
//   - exact_email — non-admins must supply a full email; admins keep
//     substring search.
//   - open        — everyone gets substring search.
// "Admin" here mirrors the existing collections/edit.tsx pattern: holding
// DAV:write-properties on either virtual directory resource.
// ---------------------------------------------------------------------------

const SEARCH_LIMIT = 20;
const MIN_QUERY_LENGTH = 2;
const VALID_RESOURCE_TYPES: ReadonlySet<string> = new Set([
	"principal",
	"collection",
	"instance",
	"virtual",
]);

const renderOptions = (
	results: ReadonlyArray<PrincipalWithUser>,
): VNode<unknown> => (
	<>
		{results.map((r) => (
			<option
				key={r.principal.id}
				value={r.principal.slug}
				label={`${r.principal.displayName ?? r.principal.slug} (${r.user.email})`}
			/>
		))}
	</>
);

type UserSearchMode = "admin_only" | "exact_email" | "open";

// Only someone who could actually grant access on this resource may enumerate
// candidates through it - reuses the same DAV:write-acl gate the mutating
// endpoints check, so this never becomes a generic people-search oracle
// unrelated to a sharing action in progress.
const canGrantOnResource = Effect.fn("ui.principalSearch.canGrant")(function* (
	principalId: PrincipalId,
	resourceType: string,
	resourceId: string,
) {
	if (!(resourceType && resourceId && VALID_RESOURCE_TYPES.has(resourceType))) {
		return true;
	}
	const acl = yield* AclService;
	return yield* acl
		.check(
			principalId,
			resourceId as AclResourceId,
			resourceType as ResourceType,
			"DAV:write-acl",
		)
		.pipe(
			Effect.map(() => true),
			Effect.orElseSucceed(() => false),
		);
});

// The candidates a query returns under the configured search mode
const searchCandidates = Effect.fn("ui.principalSearch.candidates")(function* (
	mode: UserSearchMode,
	isAdmin: boolean,
	q: string,
) {
	const principalService = yield* PrincipalService;
	if (mode === "admin_only" && !isAdmin) {
		return [];
	}
	if (mode === "exact_email" && !isAdmin) {
		if (!q.includes("@")) {
			return [];
		}
		const found = yield* principalService.findByEmailExact(Email(q));
		return Option.match(found, { onNone: () => [], onSome: (r) => [r] });
	}
	if (q.length < MIN_QUERY_LENGTH) {
		return [];
	}
	return yield* principalService.searchByDisplayName(q, SEARCH_LIMIT);
});

export const principalSearchHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | PrincipalService | AppConfigService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const url = new URL(req.url);
		// HTMX serializes the triggering input's own name=value pair into the
		// request — the picker's text input is named "principalSlug" (that's
		// also what the Share form submits), so that's the query param here,
		// not a generic "q".
		const q = url.searchParams.get("principalSlug")?.trim() ?? "";
		const canGrant = yield* canGrantOnResource(
			principal.principalId,
			url.searchParams.get("resourceType") ?? "",
			url.searchParams.get("resourceId") ?? "",
		);
		if (!canGrant) {
			return yield* renderFragment(renderOptions([]));
		}

		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const [usersPrivs, groupsPrivs] = yield* Effect.all([
			acl.currentUserPrivileges(
				principal.principalId,
				USERS_VIRTUAL_RESOURCE_ID,
				"virtual",
			),
			acl.currentUserPrivileges(
				principal.principalId,
				GROUPS_VIRTUAL_RESOURCE_ID,
				"virtual",
			),
		]);
		// "Admin" mirrors the collections/edit.tsx pattern: holding
		// DAV:write-properties on either virtual directory resource.
		const isAdmin =
			usersPrivs.includes("DAV:write-properties") ||
			groupsPrivs.includes("DAV:write-properties");

		const results = yield* searchCandidates(
			config.sharing.userSearchMode,
			isAdmin,
			q,
		);
		return yield* renderFragment(renderOptions(results));
	});
