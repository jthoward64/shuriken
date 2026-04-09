// ---------------------------------------------------------------------------
// DAV:sync-collection REPORT — RFC 6578
//
// Returns changes to a collection since a given sync-token.
//
// Initial sync (empty or absent token): returns all current instances.
// Delta sync: returns instances changed since token + 404 hrefs for deleted.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { type ClarkName, cn } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	conflict,
	forbidden,
	methodNotAllowed,
	unauthorized,
} from "#src/domain/errors.ts";
import { COLLECTION_TYPE_TO_NAMESPACE } from "#src/domain/types/collection-namespace.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	buildInstanceProps,
	type PropfindKind,
	splitPropstats,
} from "#src/http/dav/methods/instance-props.ts";
import { extractPropNames } from "#src/http/dav/methods/report/parse.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import { TombstoneRepository } from "#src/services/tombstone/index.ts";

// ---------------------------------------------------------------------------
// Sync token URN helpers
// ---------------------------------------------------------------------------

const SYNC_TOKEN_PREFIX = "urn:ietf:params:xml:ns:sync:";

const parseSyncToken = (raw: string): number | null => {
	if (!raw.startsWith(SYNC_TOKEN_PREFIX)) {
		return null;
	}
	const n = Number.parseInt(raw.slice(SYNC_TOKEN_PREFIX.length), 10);
	return Number.isFinite(n) ? n : null;
};

const formatSyncToken = (n: number): string => `${SYNC_TOKEN_PREFIX}${n}`;

// ---------------------------------------------------------------------------
// Body helpers
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";

/** Extract the text value of the first child matching `key` from a tree object. */
const childText = (tree: unknown, key: ClarkName): string | undefined => {
	if (typeof tree !== "object" || tree === null) {
		return undefined;
	}
	const val = (tree as Record<string, unknown>)[key];
	return typeof val === "string" ? val : undefined;
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const syncCollectionHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	tree: unknown,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	| CollectionService
	| InstanceService
	| InstanceRepository
	| TombstoneRepository
	| AclService
> =>
	Effect.gen(function* () {
		// Only valid on a collection path
		if (path.kind !== "collection") {
			return yield* methodNotAllowed(
				"DAV:sync-collection REPORT requires a collection URL",
			);
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const actingPrincipalId = ctx.auth.principal.principalId;

		const acl = yield* AclService;
		yield* acl.check(
			actingPrincipalId,
			path.collectionId,
			"collection",
			"DAV:read",
		);

		const collSvc = yield* CollectionService;
		const collRow = yield* collSvc.findById(path.collectionId);

		// Validate sync-level — RFC 6578 §6.4: the server MUST reject unsupported levels.
		// The only supported level is "1" (shallow sync).
		const syncLevel = childText(tree, cn(DAV_NS, "sync-level"));
		if (syncLevel !== undefined && syncLevel !== "1") {
			return yield* forbidden("DAV:supported-sync-level");
		}

		// Parse sync-token from request body
		const rawToken = childText(tree, cn(DAV_NS, "sync-token")) ?? "";
		const initialRevision = rawToken === "" ? 0 : parseSyncToken(rawToken);

		if (initialRevision === null) {
			// Invalid token format
			return yield* conflict("DAV:valid-sync-token", "Invalid sync token");
		}

		// Token must not be in the future
		if (initialRevision > collRow.synctoken) {
			return yield* conflict(
				"DAV:valid-sync-token",
				"Sync token is ahead of server",
			);
		}

		// Requested prop names
		const propNames = extractPropNames(tree);
		const propfind: PropfindKind =
			propNames.size > 0
				? { type: "prop", names: propNames }
				: { type: "allprop" };

		const origin = ctx.url.origin;
		const ns =
			(COLLECTION_TYPE_TO_NAMESPACE as Record<string, string>)[
				collRow.collectionType
			] ?? "col";

		const responses: Array<DavResponse> = [];

		if (initialRevision === 0) {
			// Initial sync: return all non-deleted instances
			const instSvc = yield* InstanceService;
			const instances = yield* instSvc.listByCollection(path.collectionId);
			for (const inst of instances) {
				const href = `${origin}/dav/principals/${path.principalSeg}/${ns}/${path.collectionSeg}/${inst.id}`;
				responses.push({
					href,
					propstats: splitPropstats(buildInstanceProps(inst), propfind),
				});
			}
		} else {
			// Delta sync: changed instances + tombstones
			const instRepo = yield* InstanceRepository;
			const tombstoneRepo = yield* TombstoneRepository;

			const [changedInstances, tombstones] = yield* Effect.all([
				instRepo.findChangedSince(path.collectionId, initialRevision),
				tombstoneRepo.findSinceRevision(path.collectionId, initialRevision),
			]);

			for (const inst of changedInstances) {
				const href = `${origin}/dav/principals/${path.principalSeg}/${ns}/${path.collectionSeg}/${inst.id}`;
				responses.push({
					href,
					propstats: splitPropstats(buildInstanceProps(inst), propfind),
				});
			}

			for (const tombstone of tombstones) {
				// Prefer the client-supplied slug variant; fall back to the tombstone UUID.
				const seg = tombstone.uriVariants[0] ?? tombstone.id;
				const href = `${origin}/dav/principals/${path.principalSeg}/${ns}/${path.collectionSeg}/${seg}`;
				responses.push({
					href,
					propstats: [{ props: {} as Record<ClarkName, unknown>, status: 404 }],
				});
			}
		}

		const newSyncToken = formatSyncToken(collRow.synctoken);
		return yield* multistatusResponse(responses, newSyncToken);
	});
