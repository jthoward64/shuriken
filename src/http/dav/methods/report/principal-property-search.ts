// ---------------------------------------------------------------------------
// DAV:principal-property-search REPORT — RFC 3744 §9.4
//
// Searches all principals whose properties contain character data matching
// the search criteria.  The only searchable property we support is
// DAV:displayname (caseless substring match, falling back to email when
// displayName is not set).
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { ClarkName } from "#src/data/ir.ts";
import { cn } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	type PropfindKind,
	splitPropstats,
} from "#src/http/dav/methods/instance-props.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";
import type { PrincipalWithUser } from "#src/services/principal/repository.ts";

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";
const DISPLAYNAME = cn(DAV_NS, "displayname");
const CAL_HOME_SET = cn(CALDAV_NS, "calendar-home-set");
const CARD_HOME_SET = cn(CARDDAV_NS, "addressbook-home-set");
// Generous cap for this RFC 3744 §9.4 REPORT (distinct from the Share UI's
// tighter, keystroke-driven search limit) — avoids an unbounded scan while
// still supporting the "list all principals" idiom for realistic directory sizes.
const PRINCIPAL_SEARCH_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Body parsing helpers
// ---------------------------------------------------------------------------

/** True when an unknown value is a plain (non-null) object */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** Clark-notation element names inside a `<D:prop>` element */
const propNamesOf = (propEl: Record<string, unknown>): Array<ClarkName> =>
	Object.keys(propEl)
		.filter((k) => !k.startsWith("@_"))
		.map((k) => k as ClarkName);

interface PropertySearch {
	readonly propNames: ReadonlyArray<ClarkName>;
	readonly matchString: string;
}

/** Extract all <DAV:property-search> elements from the request tree. */
const parsePropertySearches = (
	tree: Record<string, unknown>,
): ReadonlyArray<PropertySearch> => {
	const psKey = cn(DAV_NS, "property-search");
	const raw = tree[psKey];
	const items = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];

	return items.flatMap((item) => {
		if (!isRecord(item)) {
			return [];
		}
		const matchEl = item[cn(DAV_NS, "match")];
		const matchString = typeof matchEl === "string" ? matchEl.trim() : "";
		if (!matchString) {
			return [];
		}
		const propEl = item[cn(DAV_NS, "prop")];
		return isRecord(propEl)
			? [{ propNames: propNamesOf(propEl), matchString }]
			: [];
	});
};

/**
 * The display-name substring to search for.
 *
 * RFC 3744 §9.4 expects at least one <property-search>, but the widespread
 * "list all principals" idiom — python-caldav's search_principals() with no
 * name filter — sends a criteria-less query to enumerate every principal.
 * Treat that as a match-all (an empty substring matches every principal).
 * A query that *does* carry criteria but only for properties we can't search
 * (anything other than DAV:displayname) yields none, so no matches.
 */
const displayNameSearchTerm = (
	searches: ReadonlyArray<PropertySearch>,
): Option.Option<string> => {
	if (searches.length === 0) {
		return Option.some("");
	}
	// Use the first match string (clients typically send one search)
	const matches = searches
		.filter((s) => s.propNames.includes(DISPLAYNAME))
		.map((s) => s.matchString);
	return matches.length === 0 ? Option.none() : Option.some(matches[0] ?? "");
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const principalPropertySearchHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	tree: unknown,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	PrincipalRepository | AclService
> =>
	Effect.gen(function* () {
		// RFC 3744 §9.4: only valid on a collection (principal collection or root)
		if (
			path.kind !== "collection" &&
			path.kind !== "principalCollection" &&
			path.kind !== "root"
		) {
			return yield* methodNotAllowed(
				"DAV:principal-property-search REPORT requires a collection URL",
			);
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}

		const origin = ctx.url.origin;

		const obj: Record<string, unknown> = isRecord(tree) ? tree : {};

		const searches = parsePropertySearches(obj);

		// Extract requested return prop names; an absent <D:prop> means every one
		const returnPropEl = obj[cn(DAV_NS, "prop")];
		const propfind: PropfindKind = isRecord(returnPropEl)
			? { type: "prop", names: new Set(propNamesOf(returnPropEl)) }
			: { type: "allprop" };

		const principalRepo = yield* PrincipalRepository;
		const matched = yield* Option.match(displayNameSearchTerm(searches), {
			onNone: () => Effect.succeed<ReadonlyArray<PrincipalWithUser>>([]),
			onSome: (term) =>
				principalRepo.searchByDisplayName(term, PRINCIPAL_SEARCH_LIMIT),
		});

		const responses: Array<DavResponse> = [];

		for (const row of matched) {
			const principalHref = `${origin}/dav/principals/${row.principal.id}/`;

			const allProps: Record<ClarkName, unknown> = {
				[DISPLAYNAME]: row.principal.displayName ?? row.principal.slug,
				[cn(DAV_NS, "resourcetype")]: { [cn(DAV_NS, "principal")]: "" },
				[cn(DAV_NS, "principal-URL")]: {
					[cn(DAV_NS, "href")]: principalHref,
				},
				// RFC 4791 §6.2.1 / RFC 6352 §7.1.1: principal discovery clients
				// (e.g. python-caldav) request the home-sets here to locate a user's
				// calendars/address books. Mirror the PROPFIND values — the per-type
				// home collections, not the principal root.
				[CAL_HOME_SET]: { [cn(DAV_NS, "href")]: `${principalHref}cal/` },
				[CARD_HOME_SET]: { [cn(DAV_NS, "href")]: `${principalHref}card/` },
			};

			responses.push({
				href: principalHref,
				propstats: splitPropstats(allProps, propfind),
			});
		}

		return yield* multistatusResponse(responses);
	});
