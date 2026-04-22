import { and, eq, gt } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { davTombstone } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import { TombstoneRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// TombstoneRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findSinceRevision = Effect.fn("TombstoneRepository.findSinceRevision")(
	function* (
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
		return yield* runDbQuery((db) =>
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
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.tombstone.findSinceRevision failed", e.cause),
	),
);

export const TombstoneRepositoryLive = Layer.effect(
	TombstoneRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(e: Effect.Effect<A, E, DatabaseClient>): Effect.Effect<A, E> =>
			Effect.provideService(e, DatabaseClient, dc);
		return TombstoneRepository.of({
			findSinceRevision: (...args: Parameters<typeof findSinceRevision>) =>
				run(findSinceRevision(...args)),
		});
	}),
);
