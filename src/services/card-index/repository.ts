import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// CardIndexRepository — data access for card_index rows
//
// The card_index table is populated and maintained automatically by the
// maintain_card_index_on_instance_change() SQL trigger fired AFTER INSERT OR
// UPDATE on dav_instance.
//
// The `data` JSONB column holds extracted vCard properties. Generated columns
// `data_ascii_fold` and `data_unicode_fold` enable efficient case-insensitive
// matching for RFC 6352 addressbook-query filters.
// ---------------------------------------------------------------------------

/** vCard properties that can be text-matched via the card_index. */
export type CardIndexField = "fn" | "email" | "tel" | "uid";

/** RFC 6352 §8.3.4 collation identifiers. */
export type CardCollation = "i;ascii-casemap" | "i;unicode-casemap";

/** RFC 6352 §8.3.4 match types. */
export type CardMatchType = "equals" | "contains" | "starts-with" | "ends-with";

export interface CardIndexRepositoryShape {
	/**
	 * Return entity UUIDs whose card_index entry matches the given text filter.
	 *
	 * Uses the generated case-fold columns (`fn_ascii_fold`, `fn_unicode_fold`,
	 * `data_ascii_fold`, `data_unicode_fold`) for efficient case-insensitive
	 * matching without a full table scan.
	 */
	readonly findByText: (
		collectionId: CollectionId,
		text: string,
		field: CardIndexField,
		collation: CardCollation,
		matchType: CardMatchType,
	) => Effect.Effect<ReadonlyArray<string>, DatabaseError>;
}

export class CardIndexRepository extends Context.Tag("CardIndexRepository")<
	CardIndexRepository,
	CardIndexRepositoryShape
>() {}
