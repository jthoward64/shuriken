import { and, eq, gt } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { davTombstone } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import { TombstoneRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// TombstoneRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findSinceRevision = Effect.fn("TombstoneRepository.findSinceRevision")(
	function* (
		db: DbClient,
		collectionId: CollectionId,
		sinceSyncRevision: number,
	) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"tombstone.since_revision": sinceSyncRevision,
		});
		yield* Effect.logTrace("repo.tombstone.findSinceRevision", {
			collectionId,
			sinceSyncRevision,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(davTombstone)
					.where(
						and(
							eq(davTombstone.collectionId, collectionId),
							gt(davTombstone.syncRevision, sinceSyncRevision),
						),
					)
					.orderBy(davTombstone.syncRevision),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.tombstone.findSinceRevision failed", e.cause),
	),
);

export const TombstoneRepositoryLive = Layer.effect(
	TombstoneRepository,
	Effect.map(DatabaseClient, (db) =>
		TombstoneRepository.of({
			findSinceRevision: (collectionId, since) =>
				findSinceRevision(db, collectionId, since),
		}),
	),
);
