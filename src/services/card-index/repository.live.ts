import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { cardIndex, davInstance } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import {
	CardIndexRepository,
	type CardIndexField,
	type CardCollation,
	type CardMatchType,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// CardIndexRepository — Drizzle implementation
//
// Uses the pre-computed case-fold generated columns (fn_ascii_fold,
// fn_unicode_fold, data_ascii_fold, data_unicode_fold) to evaluate text
// filters without a full table scan.
//
// The input text is pre-folded on the JS side with toLowerCase() as an
// approximation of i;ascii-casemap. For i;unicode-casemap, we also apply
// Unicode NFC normalization. This makes the SQL comparison straightforward
// against the already-folded columns.
//
// False positives are acceptable here because the caller (addressbook-query
// handler) always runs in-memory evaluateCardFilter() as a final pass.
// ---------------------------------------------------------------------------

/** Apply the same case-folding used by the generated columns to a search string. */
const foldText = (text: string, collation: CardCollation): string => {
	// i;ascii-casemap: uppercase A–Z map to a–z, all else unchanged.
	// i;unicode-casemap: full Unicode case-fold (NFC + lowercase approximation).
	// For pre-filter purposes, toLowerCase() is sufficient for both collations.
	if (collation === "i;unicode-casemap") {
		// NFC normalize before lowercasing to match the unicode_casemap_nfc function.
		return text.normalize("NFC").toLowerCase();
	}
	return text.toLowerCase();
};

/** Build a SQL LIKE pattern based on the match type. */
const likePattern = (foldedText: string, matchType: CardMatchType): string => {
	const escaped = foldedText.replace(/[%_\\]/g, (c) => `\\${c}`);
	switch (matchType) {
		case "equals":
			return foldedText;
		case "contains":
			return `%${escaped}%`;
		case "starts-with":
			return `${escaped}%`;
		case "ends-with":
			return `%${escaped}`;
	}
};

const findByText = Effect.fn("CardIndexRepository.findByText")(function* (
	db: DbClient,
	collectionId: CollectionId,
	text: string,
	field: CardIndexField,
	collation: CardCollation,
	matchType: CardMatchType,
) {
	yield* Effect.logTrace("repo.card-index.findByText", {
		collectionId,
		field,
		matchType,
	});

	const folded = foldText(text, collation);
	const pattern = likePattern(folded, matchType);
	const useUnicode = collation === "i;unicode-casemap";

	return yield* Effect.tryPromise({
		try: () => {
			// Build the WHERE predicate against the appropriate fold column.
			let fieldCondition: ReturnType<typeof sql>;

			if (field === "fn") {
				const col = useUnicode ? cardIndex.fnUnicodeFold : cardIndex.fnAsciiFold;
				if (matchType === "equals") {
					fieldCondition = sql`${col} = ${folded}`;
				} else {
					fieldCondition = sql`${col} LIKE ${pattern} ESCAPE '\\'`;
				}
			} else if (field === "uid") {
				// uid column has no fold version; compare case-insensitively
				if (matchType === "equals") {
					fieldCondition = sql`lower(${cardIndex.uid}) = ${folded}`;
				} else {
					fieldCondition = sql`lower(${cardIndex.uid}) LIKE ${pattern} ESCAPE '\\'`;
				}
			} else {
				// email / tel: stored as JSON arrays in data_ascii_fold / data_unicode_fold
				const dataCol = useUnicode
					? cardIndex.dataUnicodeFold
					: cardIndex.dataAsciiFold;
				const jsonKey = field === "email" ? "emails" : "phones";

				if (matchType === "equals") {
					// Array containment check: the folded array contains the folded text
					fieldCondition = sql`${dataCol}->${jsonKey} @> to_jsonb(${folded}::text)`;
				} else {
					// For partial matches, check if any array element matches the pattern
					fieldCondition = sql`EXISTS (
						SELECT 1 FROM jsonb_array_elements_text(${dataCol}->${jsonKey}) _e
						WHERE _e LIKE ${pattern} ESCAPE '\\'
					)`;
				}
			}

			return db
				.selectDistinct({ entityId: cardIndex.entityId })
				.from(cardIndex)
				.innerJoin(
					davInstance,
					and(
						eq(cardIndex.entityId, davInstance.entityId),
						eq(davInstance.collectionId, collectionId),
						isNull(davInstance.deletedAt),
					),
				)
				.where(and(isNull(cardIndex.deletedAt), fieldCondition))
				.then((rows) => rows.map((r) => r.entityId));
		},
		catch: (e) => new DatabaseError({ cause: e }),
	});
}, Effect.tapError((e) => Effect.logWarning("repo.card-index.findByText failed", e.cause)));

export const CardIndexRepositoryLive = Layer.effect(
	CardIndexRepository,
	Effect.map(DatabaseClient, (db) =>
		CardIndexRepository.of({
			findByText: (collectionId, text, field, collation, matchType) =>
				findByText(db, collectionId, text, field, collation, matchType),
		}),
	),
);
