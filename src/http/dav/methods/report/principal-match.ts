// ---------------------------------------------------------------------------
// DAV:principal-match REPORT — RFC 3744 §9.3
//
// Given a collection URL, returns all members that are principals matching
// the current user.
//
// Two modes:
//   <self/>                 — find principals in the collection that ARE the
//                             current user.
//   <principal-property>X</principal-property> — find resources whose
//                             property X contains an href identifying the
//                             current user's principal.
//
// We implement the <self/> case, which is what CalDAV clients primarily use
// against /dav/principals/ to discover their own principal URL.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { ClarkName } from "#src/data/ir.ts";
import { cn } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";

const DAV_NS = "DAV:";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const principalMatchHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	tree: unknown,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	PrincipalRepository | AclService
> =>
	Effect.gen(function* () {
		// RFC 3744 §9.3: only valid on a collection
		if (
			path.kind !== "collection" &&
			path.kind !== "principalCollection" &&
			path.kind !== "root"
		) {
			return yield* methodNotAllowed(
				"DAV:principal-match REPORT requires a collection URL",
			);
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const actingPrincipalId = ctx.auth.principal.principalId;

		const origin = ctx.url.origin;

		// Parse request body: does it use <self/> or <principal-property>?
		const obj =
			typeof tree === "object" && tree !== null
				? (tree as Record<string, unknown>)
				: {};
		const hasSelf = cn(DAV_NS, "self") in obj;

		// Extract requested prop names (optional)
		const propEl = obj[cn(DAV_NS, "prop")];
		const requestedProps =
			typeof propEl === "object" && propEl !== null
				? new Set<ClarkName>(
						Object.keys(propEl as Record<string, unknown>)
							.filter((k) => !k.startsWith("@_"))
							.map((k) => k as ClarkName),
					)
				: null;

		if (hasSelf || !(cn(DAV_NS, "principal-property") in obj)) {
			// <self/> mode: return the current user's principal resource.
			const principalHref = `${origin}/dav/principals/${actingPrincipalId}/`;

			const principalRepo = yield* PrincipalRepository;
			const principalOpt = yield* principalRepo.findById(actingPrincipalId);

			if (Option.isNone(principalOpt)) {
				return yield* multistatusResponse([]);
			}

			const principalRow = principalOpt.value;

			const allProps: Record<ClarkName, unknown> = {
				[cn(DAV_NS, "displayname")]:
					principalRow.principal.displayName ?? principalRow.principal.slug,
				[cn(DAV_NS, "resourcetype")]: { [cn(DAV_NS, "principal")]: "" },
				[cn(DAV_NS, "principal-URL")]: {
					[cn(DAV_NS, "href")]: principalHref,
				},
			};

			const props = requestedProps
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

			return yield* multistatusResponse([
				{ href: principalHref, propstats: props },
			]);
		}

		// <principal-property> mode not implemented — return empty multistatus.
		// Clients rarely use this variant against a principals collection.
		return yield* multistatusResponse([]);
	});
