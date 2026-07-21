import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { cardIndex, davInstance } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import type { CollectionId, EntityId } from "#src/domain/ids.ts";
import {
	type CardCollation,
	type CardIndexField,
	CardIndexRepository,
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

const findByText = Effect.fn("CardIndexRepository.findByText")(
	function* (
		collectionId: CollectionId,
		text: string,
		field: CardIndexField,
		collation: CardCollation,
		matchType: CardMatchType,
	) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"card.field": field,
			"card.match_type": matchType,
		});
		yield* Effect.logTrace("repo.card-index.findByText", {
			collectionId,
			field,
			matchType,
		});

		const folded = foldText(text, collation);
		const pattern = likePattern(folded, matchType);
		const useUnicode = collation === "i;unicode-casemap";

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

		return yield* runDbQuery((db) =>
			db
				.selectDistinct({ instanceId: davInstance.id })
				.from(cardIndex)
				.innerJoin(
					davInstance,
					and(
						eq(cardIndex.entityId, davInstance.entityId),
						eq(davInstance.collectionId, collectionId),
						isNull(davInstance.deletedAt),
					),
				)
				.where(and(isNull(cardIndex.deletedAt), fieldCondition)),
		).pipe(Effect.map((rows) => rows.map((r) => r.instanceId)));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.card-index.findByText failed", e.cause),
	),
);

/** Match FN case-insensitively against the unicode fold column. This is the
 * actual filter (not a pre-filter), so no in-memory second pass is required. */
const fnFilterCondition = (
	fnFilter: string | undefined,
): ReturnType<typeof sql> | undefined =>
	fnFilter !== undefined && fnFilter !== ""
		? sql`${cardIndex.fnUnicodeFold} LIKE ${likePattern(
				foldText(fnFilter, "i;unicode-casemap"),
				"contains",
			)} ESCAPE '\\'`
		: undefined;

const listForCollection = Effect.fn("CardIndexRepository.listForCollection")(
	function* (
		collectionId: CollectionId,
		fnFilter?: string,
		page?: { readonly limit: number; readonly offset: number },
	) {
		yield* Effect.annotateCurrentSpan({ "collection.id": collectionId });
		yield* Effect.logTrace("repo.card-index.listForCollection", {
			collectionId,
			filtered: fnFilter !== undefined && fnFilter !== "",
			page,
		});

		const fnCondition = fnFilterCondition(fnFilter);

		return yield* runDbQuery((db) => {
			const query = db
				.select({
					instanceId: davInstance.id,
					fn: cardIndex.fn,
					email: sql<string | null>`${cardIndex.data}->'emails'->>0`,
					tel: sql<string | null>`${cardIndex.data}->'phones'->>0`,
					org: sql<string | null>`${cardIndex.data}->>'org'`,
					title: sql<string | null>`${cardIndex.data}->>'title'`,
					hasPhoto: sql<boolean>`COALESCE((${cardIndex.data}->>'has_photo')::boolean, false)`,
				})
				.from(cardIndex)
				.innerJoin(
					davInstance,
					and(
						eq(cardIndex.entityId, davInstance.entityId),
						eq(davInstance.collectionId, collectionId),
						isNull(davInstance.deletedAt),
					),
				)
				.where(and(isNull(cardIndex.deletedAt), fnCondition))
				.orderBy(sql`${cardIndex.fnUnicodeFold} NULLS LAST`);
			return page === undefined
				? query
				: query.limit(page.limit).offset(page.offset);
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.card-index.listForCollection failed", e.cause),
	),
);

const countForCollection = Effect.fn("CardIndexRepository.countForCollection")(
	function* (collectionId: CollectionId, fnFilter?: string) {
		yield* Effect.annotateCurrentSpan({ "collection.id": collectionId });

		const fnCondition = fnFilterCondition(fnFilter);

		const rows = yield* runDbQuery((db) =>
			db
				.select({ count: sql<number>`count(*)::int` })
				.from(cardIndex)
				.innerJoin(
					davInstance,
					and(
						eq(cardIndex.entityId, davInstance.entityId),
						eq(davInstance.collectionId, collectionId),
						isNull(davInstance.deletedAt),
					),
				)
				.where(and(isNull(cardIndex.deletedAt), fnCondition)),
		);
		return rows[0]?.count ?? 0;
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.card-index.countForCollection failed", e.cause),
	),
);

/** Coerce a JSONB array of strings (or null) into a plain string array. */
const asStringArray = (raw: unknown): ReadonlyArray<string> =>
	Array.isArray(raw)
		? raw.filter((v): v is string => typeof v === "string")
		: [];

const listForDedup = Effect.fn("CardIndexRepository.listForDedup")(
	function* (collectionIds: ReadonlyArray<CollectionId>) {
		yield* Effect.annotateCurrentSpan({
			"collection.count": collectionIds.length,
		});
		if (collectionIds.length === 0) {
			return [];
		}

		const rows = yield* runDbQuery((db) =>
			db
				.select({
					instanceId: davInstance.id,
					entityId: cardIndex.entityId,
					collectionId: davInstance.collectionId,
					fn: cardIndex.fn,
					emails: sql<unknown>`${cardIndex.data}->'emails'`,
					phones: sql<unknown>`${cardIndex.data}->'phones'`,
				})
				.from(cardIndex)
				.innerJoin(
					davInstance,
					and(
						eq(cardIndex.entityId, davInstance.entityId),
						inArray(davInstance.collectionId, collectionIds),
						isNull(davInstance.deletedAt),
					),
				)
				.where(isNull(cardIndex.deletedAt)),
		);

		return rows.map((r) => ({
			instanceId: r.instanceId,
			entityId: r.entityId,
			collectionId: r.collectionId,
			fn: r.fn,
			emails: asStringArray(r.emails),
			phones: asStringArray(r.phones),
		}));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.card-index.listForDedup failed", e.cause),
	),
);

const listWithBday = Effect.fn("CardIndexRepository.listWithBday")(
	function* (collectionId: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": collectionId });
		const rows = yield* runDbQuery((db) =>
			db
				.selectDistinctOn([cardIndex.entityId], {
					entityId: cardIndex.entityId,
					uid: cardIndex.uid,
					fn: cardIndex.fn,
					bday: sql<string>`${cardIndex.data}->>'bday'`,
				})
				.from(cardIndex)
				.innerJoin(
					davInstance,
					and(
						eq(davInstance.entityId, cardIndex.entityId),
						eq(davInstance.collectionId, collectionId),
						isNull(davInstance.deletedAt),
					),
				)
				.where(
					and(
						isNull(cardIndex.deletedAt),
						sql`${cardIndex.data}->>'bday' IS NOT NULL`,
					),
				),
		);
		return rows
			.filter((r) => r.uid !== null && r.fn !== null && r.bday !== null)
			.map((r) => ({
				entityId: r.entityId as EntityId,
				uid: r.uid as string,
				fn: r.fn as string,
				bday: r.bday,
			}));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.card-index.listWithBday failed", e.cause),
	),
);

export const CardIndexRepositoryLive = Layer.effect(
	CardIndexRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			findByText: (...args: Parameters<typeof findByText>) =>
				run(findByText(...args)),
			listForCollection: (...args: Parameters<typeof listForCollection>) =>
				run(listForCollection(...args)),
			countForCollection: (...args: Parameters<typeof countForCollection>) =>
				run(countForCollection(...args)),
			listForDedup: (...args: Parameters<typeof listForDedup>) =>
				run(listForDedup(...args)),
			listWithBday: (...args: Parameters<typeof listWithBday>) =>
				run(listWithBday(...args)),
		};
	}),
);
