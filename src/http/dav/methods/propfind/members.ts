// ---------------------------------------------------------------------------
// Depth:1 collection members, shared by the principal and collection-home branches
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { CollectionId } from "#src/domain/ids.ts";
import { COLLECTION_TYPE_TO_NAMESPACE } from "#src/domain/types/collection-namespace.ts";
import { AclService } from "#src/services/acl/index.ts";
import {
	applyReadOnlyPrivileges,
	isReadOnlyCollectionRow,
} from "#src/services/collection/read-only-guard.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { collectionResponse } from "./collection-props.ts";
import type { PropfindContext } from "./context.ts";
import { collectionHref } from "./href.ts";

/** The namespace segment a collection lives under, defaulting to the plain one */
export const namespaceOf = (collectionType: string): string =>
	(COLLECTION_TYPE_TO_NAMESPACE as Record<string, string>)[collectionType] ??
	"col";

/**
 * Builds the depth:1 member response for one collection. Member hrefs use the
 * stored slug so they match the URL the client created the collection at.
 */
export const collectionMemberResponse = Effect.fn("dav.propfind.member")(
	function* (coll: CollectionRow, principalSeg: string, ctx: PropfindContext) {
		const href = collectionHref(
			ctx.origin,
			principalSeg,
			namespaceOf(coll.collectionType),
			coll.slug || coll.id,
		);
		const acl = yield* AclService;
		const privileges = applyReadOnlyPrivileges(
			yield* acl.currentUserPrivileges(
				ctx.actingPrincipalId,
				CollectionId(coll.id),
				"collection",
			),
			yield* isReadOnlyCollectionRow(coll),
		);
		return collectionResponse(href, coll, {
			request: ctx.request,
			origin: ctx.origin,
			privileges,
			actingPrincipalHref: ctx.actingPrincipalHref,
		});
	},
);
