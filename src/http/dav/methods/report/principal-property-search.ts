// ---------------------------------------------------------------------------
// DAV:principal-property-search REPORT — RFC 3744 §9.4
//
// Searches all principals whose properties contain character data matching
// the search criteria.  The only searchable property we support is
// DAV:displayname (caseless substring match, falling back to email when
// displayName is not set).
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { ClarkName } from "#src/data/ir.ts";
import { cn } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";

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
		if (typeof item !== "object" || item === null) {
			return [];
		}
		const obj = item as Record<string, unknown>;
		const matchEl = obj[cn(DAV_NS, "match")];
		const matchString = typeof matchEl === "string" ? matchEl.trim() : "";
		if (!matchString) {
			return [];
		}
		const propEl = obj[cn(DAV_NS, "prop")];
		if (typeof propEl !== "object" || propEl === null) {
			return [];
		}
		const propNames = Object.keys(propEl as Record<string, unknown>)
			.filter((k) => !k.startsWith("@_"))
			.map((k) => k as ClarkName);
		return [{ propNames, matchString }];
	});
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

		const obj =
			typeof tree === "object" && tree !== null
				? (tree as Record<string, unknown>)
				: {};

		const searches = parsePropertySearches(obj);

		// Extract requested return prop names
		const propEl = obj[cn(DAV_NS, "prop")];
		const requestedProps =
			typeof propEl === "object" && propEl !== null
				? new Set<ClarkName>(
						Object.keys(propEl as Record<string, unknown>)
							.filter((k) => !k.startsWith("@_"))
							.map((k) => k as ClarkName),
					)
				: null;

		// RFC 3744 §9.4 expects at least one <property-search>, but the widespread
		// "list all principals" idiom — python-caldav's search_principals() with no
		// name filter — sends a criteria-less query to enumerate every principal.
		// Treat that as a match-all (an empty substring matches every principal).
		// A query that *does* carry criteria but only for properties we can't
		// search (anything other than DAV:displayname) still yields no matches.
		const principalRepo = yield* PrincipalRepository;
		const matched = yield* Effect.gen(function* () {
			if (searches.length === 0) {
				return yield* principalRepo.searchByDisplayName(
					"",
					PRINCIPAL_SEARCH_LIMIT,
				);
			}
			const displayNameMatches = searches
				.filter((s) => s.propNames.includes(DISPLAYNAME))
				.map((s) => s.matchString);
			if (displayNameMatches.length === 0) {
				return [];
			}
			// Use the first match string (clients typically send one search).
			return yield* principalRepo.searchByDisplayName(
				displayNameMatches[0] ?? "",
				PRINCIPAL_SEARCH_LIMIT,
			);
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

			const propstats = requestedProps
				? (() => {
						const found: Record<ClarkName, unknown> = {};
						const missing: Record<ClarkName, unknown> = {};
						for (const name of requestedProps) {
							if (name in allProps) {
								found[name] = allProps[name];
							} else {
								missing[name] = "";
							}
						}
						const stats: Array<{
							props: Record<ClarkName, unknown>;
							status: number;
						}> = [{ props: found, status: 200 }];
						if (Object.keys(missing).length > 0) {
							stats.push({ props: missing, status: 404 });
						}
						return stats;
					})()
				: [{ props: allProps, status: 200 }];

			responses.push({ href: principalHref, propstats });
		}

		return yield* multistatusResponse(responses);
	});
