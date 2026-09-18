// ---------------------------------------------------------------------------
// DAV:sync-collection REPORT — RFC 6578
//
// Returns changes to a collection since a given sync-token.
//
// Initial sync (empty or absent token): returns all current instances.
// Delta sync: returns instances changed since token + 404 hrefs for deleted.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
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
import { encodeSegment } from "#src/http/dav/encode-segment.ts";
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
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { TombstoneRepository } from "#src/services/tombstone/index.ts";
import type { TombstoneRow } from "#src/services/tombstone/repository.ts";

// ---------------------------------------------------------------------------
// Sync token URN helpers
// ---------------------------------------------------------------------------

const SYNC_TOKEN_PREFIX = "urn:ietf:params:xml:ns:sync:";

/** Read the revision number out of a sync-token URN */
const parseSyncToken = (raw: string): Option.Option<number> => {
	if (!raw.startsWith(SYNC_TOKEN_PREFIX)) {
		return Option.none();
	}
	const n = Number.parseInt(raw.slice(SYNC_TOKEN_PREFIX.length), 10);
	return Number.isFinite(n) ? Option.some(n) : Option.none();
};

const formatSyncToken = (n: number): string => `${SYNC_TOKEN_PREFIX}${n}`;

// ---------------------------------------------------------------------------
// Body helpers
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";

/** True when an unknown value is a plain (non-null) object */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** Extract the text value of the first child matching `key` from a tree object. */
const childText = (tree: unknown, key: ClarkName): string | undefined => {
	if (!isRecord(tree)) {
		return undefined;
	}
	const val = tree[key];
	return typeof val === "string" ? val : undefined;
};

// ---------------------------------------------------------------------------
// Response entries
// ---------------------------------------------------------------------------

/** Multistatus entry for one instance still present in the collection */
const instanceResponse = (
	inst: InstanceRow,
	hrefBase: string,
	propfind: PropfindKind,
): DavResponse => ({
	href: `${hrefBase}/${encodeSegment(inst.slug || inst.id)}`,
	propstats: splitPropstats(buildInstanceProps(inst), propfind),
});

/** RFC 6578 §3.2: a removed member is reported as a bare 404 propstat */
const tombstoneResponse = (
	tombstone: TombstoneRow,
	hrefBase: string,
): DavResponse => {
	// Prefer the client-supplied slug variant; fall back to the tombstone UUID
	const seg = tombstone.uriVariants[0] ?? tombstone.id;
	return {
		href: `${hrefBase}/${encodeSegment(seg)}`,
		propstats: [{ props: {} as Record<ClarkName, unknown>, status: 404 }],
	};
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
			"CALDAV:read-free-busy",
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
		const initialRevision = yield* Option.match(
			rawToken === "" ? Option.some(0) : parseSyncToken(rawToken),
			{
				// Invalid token format
				onNone: () =>
					Effect.fail(conflict("DAV:valid-sync-token", "Invalid sync token")),
				onSome: Effect.succeed,
			},
		);

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

		const ns =
			(COLLECTION_TYPE_TO_NAMESPACE as Record<string, string>)[
				collRow.collectionType
			] ?? "col";
		const hrefBase = `${ctx.url.origin}/dav/principals/${path.principalSeg}/${ns}/${path.collectionSeg}`;

		const responses: Array<DavResponse> = [];

		if (initialRevision === 0) {
			// Initial sync: return all non-deleted instances
			const instSvc = yield* InstanceService;
			const instances = yield* instSvc.listByCollection(path.collectionId);
			responses.push(
				...instances.map((inst) => instanceResponse(inst, hrefBase, propfind)),
			);
		} else {
			// Delta sync: changed instances + tombstones
			const instRepo = yield* InstanceRepository;
			const tombstoneRepo = yield* TombstoneRepository;

			const [changedInstances, tombstones] = yield* Effect.all([
				instRepo.findChangedSince(path.collectionId, initialRevision),
				tombstoneRepo.findSinceRevision(path.collectionId, initialRevision),
			]);

			responses.push(
				...changedInstances.map((inst) =>
					instanceResponse(inst, hrefBase, propfind),
				),
				...tombstones.map((tombstone) =>
					tombstoneResponse(tombstone, hrefBase),
				),
			);
		}

		const newSyncToken = formatSyncToken(collRow.synctoken);
		return yield* multistatusResponse(responses, newSyncToken);
	});
