import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId } from "#src/domain/ids.ts";

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

/**
 * A contact summary projected directly from the card_index, sufficient to
 * render a row in the contacts list without reloading the vCard component tree.
 */
export interface CardSummaryRow {
	readonly instanceId: string;
	readonly fn: string | null;
	readonly email: string | null;
	readonly tel: string | null;
	/** Whether the underlying vCard carries a PHOTO property (see the
	 * card_index trigger's data->>'has_photo'). Used by the list UI to decide
	 * between an <img> (served by the photo endpoint) and a placeholder. */
	readonly hasPhoto: boolean;
}

/**
 * A contact projected for duplicate detection: identity plus the *full* set of
 * emails and phones (not just the first of each), read straight from the
 * card_index `data` JSONB so no vCard tree reload is needed. `collectionId` is
 * carried so callers can group across several addressbooks at once.
 */
export interface DedupCardRow {
	readonly instanceId: string;
	readonly entityId: string;
	readonly collectionId: string;
	readonly fn: string | null;
	readonly emails: ReadonlyArray<string>;
	readonly phones: ReadonlyArray<string>;
}

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

	/**
	 * Return a contact summary (instance id, fn, first email, first phone) for
	 * cards in `collectionId`, directly from the card_index — no per-contact
	 * vCard tree reload. When `fnFilter` is provided, restricts the result to
	 * cards whose FN matches the substring case-insensitively (i;unicode-casemap)
	 * using the generated fold column, so search needs no in-memory second pass.
	 * Results are ordered by FN (fold column, NULLs last) so pagination is stable.
	 * When `page` is omitted, returns every matching row (unpaginated).
	 *
	 * Used by the contacts list UI for both the full listing and search.
	 */
	readonly listForCollection: (
		collectionId: CollectionId,
		fnFilter?: string,
		page?: { readonly limit: number; readonly offset: number },
	) => Effect.Effect<ReadonlyArray<CardSummaryRow>, DatabaseError>;

	/**
	 * Count cards in `collectionId` matching the same `fnFilter` semantics as
	 * {@link listForCollection}, for computing pagination totals.
	 */
	readonly countForCollection: (
		collectionId: CollectionId,
		fnFilter?: string,
	) => Effect.Effect<number, DatabaseError>;

	/**
	 * Return a {@link DedupCardRow} for every active card across the given
	 * collections, carrying the full emails/phones arrays needed by duplicate
	 * detection. An empty `collectionIds` yields an empty result without a query.
	 */
	readonly listForDedup: (
		collectionIds: ReadonlyArray<CollectionId>,
	) => Effect.Effect<ReadonlyArray<DedupCardRow>, DatabaseError>;

	/**
	 * Return every card in `collectionId` that has a non-empty BDAY value, joined
	 * via the live dav_instance row so the caller gets stable identity (entityId
	 * + uid + fn + normalized bday). Used by BirthdayService to regenerate the
	 * derived "Birthdays" calendar.
	 */
	readonly listWithBday: (collectionId: CollectionId) => Effect.Effect<
		ReadonlyArray<{
			readonly entityId: EntityId;
			readonly uid: string;
			readonly fn: string;
			readonly bday: string;
		}>,
		DatabaseError
	>;
}

export class CardIndexRepository extends Context.Service<
	CardIndexRepository,
	CardIndexRepositoryShape
>()("CardIndexRepository") {}
