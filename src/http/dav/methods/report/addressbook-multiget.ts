// ---------------------------------------------------------------------------
// CARDDAV:addressbook-multiget REPORT — RFC 6352 §8.7
//
// Fetches specific vCard objects by href, applying optional address-data
// subsetting per the <C:address-data> element in the request body.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { ClarkName, IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { AclService } from "#src/services/acl/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import { parseAddressDataSpec, subsetVCardDocument } from "./address-data.ts";
import { multigetHandler } from "./multiget.ts";
import { extractHrefs, extractPropNames } from "./parse.ts";

const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";
const cn = (local: string): ClarkName => `{${CARDDAV_NS}}${local}` as ClarkName;

const ADDRESS_DATA = cn("address-data");

export const addressbookMultigetHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	tree: unknown,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	InstanceService | ComponentRepository | AclService
> =>
	Effect.gen(function* () {
		if (path.kind !== "collection") {
			return yield* methodNotAllowed(
				"CARDDAV:addressbook-multiget REPORT requires a collection URL",
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

		const hrefs = extractHrefs(tree);
		const propNames = extractPropNames(tree);
		// <C:address-data> is nested inside <D:prop>, not at the top level
		const propEl =
			typeof tree === "object" && tree !== null
				? (tree as Record<string, unknown>)["{DAV:}prop"]
				: undefined;
		const dataTree =
			typeof propEl === "object" && propEl !== null
				? (propEl as Record<string, unknown>)[ADDRESS_DATA]
				: undefined;
		const spec = parseAddressDataSpec(dataTree);

		return yield* multigetHandler({
			hrefs,
			collectionId: path.collectionId,
			actingPrincipalId,
			propNames,
			entityType: "vcard",
			origin: ctx.url.origin,
			dataClarkName: ADDRESS_DATA,
			dataTree,
			serializeData: (doc: IrDocument) =>
				encodeVCard(subsetVCardDocument(doc, spec)),
		});
	});
