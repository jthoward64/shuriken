// ---------------------------------------------------------------------------
// CARDDAV:addressbook-query REPORT — RFC 6352 §8.6
//
// Filter-based vCard search. Evaluates a <CARDDAV:filter> against every
// candidate instance in the collection, optionally pre-filtered by the
// card_index for FN text-match queries.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { ClarkName, IrComponent, IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { EntityId, UuidString } from "#src/domain/ids.ts";
import { InstanceId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { encodeSegment } from "#src/http/dav/encode-segment.ts";
import {
	buildInstanceProps,
	type PropfindKind,
	splitPropstats,
} from "#src/http/dav/methods/instance-props.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CardIndexRepository } from "#src/services/card-index/index.ts";
import type {
	CardCollation,
	CardMatchType,
} from "#src/services/card-index/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import {
	type AddressDataSpec,
	applyVersion,
	parseAddressDataSpec,
	subsetVCardDocument,
} from "./address-data.ts";
import {
	type CardFilter,
	evaluateCardFilter,
	parseCardFilter,
} from "./filter-card.ts";
import { extractPropNames } from "./parse.ts";

const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";
const cn = (local: string): ClarkName => `{${CARDDAV_NS}}${local}` as ClarkName;

const ADDRESS_DATA = cn("address-data");

// ---------------------------------------------------------------------------
// Pre-filter hint extraction
// ---------------------------------------------------------------------------

/** A card_index FN text-match that can narrow the candidate set in SQL */
interface FnPreFilter {
	readonly text: string;
	readonly collation: CardCollation;
	readonly matchType: CardMatchType;
}

/**
 * If the filter has an allof FN text-match, return it for SQL pre-filtering.
 * This is an optimisation — false negatives are caught by in-memory evaluation.
 */
const extractFnPreFilter = (filter: CardFilter): Option.Option<FnPreFilter> => {
	// Multiple prop-filters with anyof semantics require a union of index results.
	// Fall back to full scan to avoid false negatives.
	if (filter.propFilters.length !== 1) {
		return Option.none();
	}
	const fnFilter = filter.propFilters.find(
		(pf) => pf.name.toUpperCase() === "FN",
	);
	if (!fnFilter || fnFilter.isNotDefined || fnFilter.textMatches.length === 0) {
		return Option.none();
	}
	// Only use the first text-match as a pre-filter hint (in-memory eval handles the rest)
	const tm = fnFilter.textMatches[0];
	// The card index folds case, so it can't serve a case-sensitive i;octet
	// match — fall back to a full scan (the in-memory eval handles i;octet).
	if (!tm || tm.negate || tm.collation === "i;octet") {
		return Option.none();
	}
	return Option.some({
		text: tm.value,
		collation: tm.collation,
		matchType: tm.matchType,
	});
};

// ---------------------------------------------------------------------------
// Request-body accessors
// ---------------------------------------------------------------------------

/** True when an unknown value is a plain (non-null) object */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** The `<C:address-data>` subsetting element inside `<D:prop>`, if present */
const addressDataTree = (tree: unknown): unknown => {
	if (!isRecord(tree)) {
		return undefined;
	}
	const propEl = tree["{DAV:}prop"];
	return isRecord(propEl) ? propEl[ADDRESS_DATA] : undefined;
};

// ---------------------------------------------------------------------------
// Per-instance response
// ---------------------------------------------------------------------------

/** What building one matching instance's response needs besides the instance */
interface QueryResponseContext {
	readonly filter: CardFilter;
	readonly spec: AddressDataSpec;
	readonly propfind: PropfindKind;
	readonly hrefBase: string;
}

/**
 * Multistatus entry for one candidate instance, or none when its tree is
 * missing or the filter rejects it.
 */
const buildQueryResponse = Effect.fn("addressbook-query.buildResponse")(
	function* (
		inst: InstanceRow,
		root: IrComponent | undefined,
		ctx: QueryResponseContext,
	) {
		if (root === undefined) {
			return Option.none<DavResponse>();
		}
		const irDoc: IrDocument = { kind: "vcard", root };
		if (!evaluateCardFilter(irDoc, ctx.filter)) {
			return Option.none<DavResponse>();
		}
		const dataStr = yield* encodeVCard(
			applyVersion(subsetVCardDocument(irDoc, ctx.spec), ctx.spec.version),
		);
		const instanceProps = buildInstanceProps(inst);
		const allProps: Record<ClarkName, unknown> = {
			...instanceProps,
			[ADDRESS_DATA]: dataStr,
		};
		return Option.some<DavResponse>({
			href: `${ctx.hrefBase}/${encodeSegment(inst.slug || inst.id)}`,
			propstats: splitPropstats(allProps, ctx.propfind),
		});
	},
);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const addressbookQueryHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	tree: unknown,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	| InstanceService
	| InstanceRepository
	| ComponentRepository
	| CardIndexRepository
	| AclService
> =>
	Effect.gen(function* () {
		if (path.kind !== "collection") {
			return yield* methodNotAllowed(
				"CARDDAV:addressbook-query REPORT requires a collection URL",
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

		// Parse filter
		const obj: Record<string, unknown> = isRecord(tree) ? tree : {};
		const filterTree = obj[cn("filter")];
		const filter = yield* parseCardFilter({ [cn("filter")]: filterTree });

		// Parse optional address-data subsetting spec (<C:address-data> is inside <D:prop>)
		const spec = parseAddressDataSpec(addressDataTree(tree));

		// Determine prop names
		const propNames = extractPropNames(tree);
		const propfind: PropfindKind =
			propNames.size > 0
				? { type: "prop", names: propNames }
				: { type: "allprop" };

		// Retrieve candidate instances — use card_index for FN pre-filtering if possible
		const instSvc = yield* InstanceService;
		const instRepo = yield* InstanceRepository;
		const cardIdx = yield* CardIndexRepository;

		// An FN text-match lets card_index narrow the candidates; otherwise scan all
		const indexed = Option.map(extractFnPreFilter(filter), (fnHint) =>
			Effect.flatMap(
				cardIdx.findByText(path.collectionId, fnHint.text, {
					field: "fn",
					collation: fnHint.collation,
					matchType: fnHint.matchType,
				}),
				(entityIds) =>
					instRepo.findByIds(
						entityIds.map((id) => InstanceId(id as UuidString)),
					),
			),
		);
		const instances = yield* Option.getOrElse(indexed, () =>
			instSvc.listByCollection(path.collectionId),
		);

		// Load, evaluate, serialize
		const compRepo = yield* ComponentRepository;

		const responseCtx: QueryResponseContext = {
			filter,
			spec,
			propfind,
			hrefBase: `${ctx.url.origin}/dav/principals/${path.principalSeg}/${path.namespace}/${path.collectionSeg}`,
		};

		// Batch-load all candidate trees in 3 queries instead of 3 per instance.
		const trees = yield* compRepo.loadTreesByIds(
			instances.map((inst) => inst.entityId as unknown as EntityId),
			"vcard",
		);

		const built = yield* Effect.forEach(instances, (inst) =>
			buildQueryResponse(
				inst,
				trees.get(inst.entityId as unknown as EntityId),
				responseCtx,
			),
		);

		return yield* multistatusResponse(built.flatMap(Option.toArray));
	});
