// ---------------------------------------------------------------------------
// CARDDAV:addressbook-query REPORT — RFC 6352 §8.6
//
// Filter-based vCard search. Evaluates a <CARDDAV:filter> against every
// candidate instance in the collection, optionally pre-filtered by the
// card_index for FN text-match queries.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { ClarkName, IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, methodNotAllowed } from "#src/domain/errors.ts";
import type { EntityId, UuidString } from "#src/domain/ids.ts";
import { InstanceId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
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
import { parseAddressDataSpec, subsetVCardDocument } from "./address-data.ts";
import { evaluateCardFilter, parseCardFilter } from "./filter-card.ts";
import { extractPropNames } from "./parse.ts";

const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";
const cn = (local: string): ClarkName => `{${CARDDAV_NS}}${local}` as ClarkName;

const ADDRESS_DATA = cn("address-data");

// ---------------------------------------------------------------------------
// Pre-filter hint extraction
// ---------------------------------------------------------------------------

/**
 * If the filter has an allof FN text-match, return it for SQL pre-filtering.
 * This is an optimisation — false negatives are caught by in-memory evaluation.
 */
const extractFnPreFilter = (
	filter: import("./filter-card.ts").CardFilter,
): {
	text: string;
	collation: CardCollation;
	matchType: CardMatchType;
} | null => {
	// Multiple prop-filters with anyof semantics require a union of index results.
	// Fall back to full scan to avoid false negatives.
	if (filter.propFilters.length !== 1) {
		return null;
	}
	const fnFilter = filter.propFilters.find(
		(pf) => pf.name.toUpperCase() === "FN",
	);
	if (!fnFilter || fnFilter.isNotDefined || fnFilter.textMatches.length === 0) {
		return null;
	}
	// Only use the first text-match as a pre-filter hint (in-memory eval handles the rest)
	const tm = fnFilter.textMatches[0];
	if (!tm || tm.negate) {
		return null;
	}
	return { text: tm.value, collation: tm.collation, matchType: tm.matchType };
};

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
			return yield* forbidden("DAV:need-privileges");
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
		const obj =
			typeof tree === "object" && tree !== null
				? (tree as Record<string, unknown>)
				: {};
		const filterTree = obj[cn("filter")];
		const filter = yield* parseCardFilter({ [cn("filter")]: filterTree });

		// Parse optional address-data subsetting spec
		const dataTree = obj[ADDRESS_DATA];
		const spec = parseAddressDataSpec(dataTree);

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

		const fnHint = extractFnPreFilter(filter);

		const instances = yield* (() => {
			if (fnHint) {
				return cardIdx
					.findByText(
						path.collectionId,
						fnHint.text,
						"fn",
						fnHint.collation,
						fnHint.matchType,
					)
					.pipe(
						Effect.flatMap((entityIds) =>
							instRepo.findByIds(
								entityIds.map((id) => InstanceId(id as UuidString)),
							),
						),
					);
			}
			return instSvc.listByCollection(path.collectionId);
		})();

		// Load, evaluate, serialize
		const compRepo = yield* ComponentRepository;
		const origin = ctx.url.origin;
		const responses: Array<DavResponse> = [];

		for (const inst of instances) {
			const treeOpt = yield* compRepo.loadTree(
				inst.entityId as unknown as EntityId,
				"vcard",
			);
			if (Option.isNone(treeOpt)) {
				continue;
			}
			const irDoc: IrDocument = { kind: "vcard", root: treeOpt.value };

			if (!evaluateCardFilter(irDoc, filter)) {
				continue;
			}

			const dataStr = yield* encodeVCard(subsetVCardDocument(irDoc, spec));

			const href = `${origin}/dav/principals/${path.principalSeg}/${path.namespace}/${path.collectionSeg}/${inst.id}`;
			const allProps: Record<ClarkName, unknown> = {
				...buildInstanceProps(inst),
				[ADDRESS_DATA]: dataStr,
			};
			responses.push({
				href,
				propstats: splitPropstats(allProps, propfind),
			});
		}

		return yield* multistatusResponse(responses);
	});
