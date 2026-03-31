import { and, eq, isNull } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DatabaseClient, type DbClient } from "#/db/client.ts";
import { davInstance } from "#/db/drizzle/schema/index.ts";
import { databaseError } from "#/domain/errors.ts";
import type { CollectionId, EntityId, InstanceId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";
import { InstanceRepository, type NewInstance } from "./repository.ts";

// ---------------------------------------------------------------------------
// InstanceRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = (db: DbClient, id: InstanceId) =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(davInstance)
        .where(and(eq(davInstance.id, id), isNull(davInstance.deletedAt)))
        .limit(1)
        .then((r) => r[0] ?? null),
    catch: (e) => databaseError(e),
  });

const findBySlug = (db: DbClient, collectionId: CollectionId, slug: Slug) =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(davInstance)
        .where(
          and(
            eq(davInstance.collectionId, collectionId),
            eq(davInstance.slug, slug),
            isNull(davInstance.deletedAt),
          ),
        )
        .limit(1)
        .then((r) => r[0] ?? null),
    catch: (e) => databaseError(e),
  });

const listByCollection = (db: DbClient, collectionId: CollectionId) =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(davInstance)
        .where(
          and(
            eq(davInstance.collectionId, collectionId),
            isNull(davInstance.deletedAt),
          ),
        ),
    catch: (e) => databaseError(e),
  });

const insertInstance = (db: DbClient, input: NewInstance) =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(davInstance)
        .values({
          collectionId: input.collectionId,
          entityId: input.entityId as unknown as EntityId,
          contentType: input.contentType,
          etag: input.etag,
          slug: input.slug,
          syncRevision: input.syncRevision ?? 1,
          scheduleTag: input.scheduleTag,
        })
        .returning()
        .then((r) => {
          const row = r[0];
          if (!row) {
            throw new Error("Insert returned no rows");
          }
          return row;
        }),
    catch: (e) => databaseError(e),
  });

const updateEtag = (
  db: DbClient,
  id: InstanceId,
  etag: string,
  syncRevision: number,
) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(davInstance)
        .set({ etag, syncRevision, updatedAt: Temporal.Now.instant() })
        .where(eq(davInstance.id, id))
        .then(() => undefined),
    catch: (e) => databaseError(e),
  });

const softDelete = (db: DbClient, id: InstanceId) =>
  Effect.tryPromise({
    try: () =>
      db
        .update(davInstance)
        .set({ deletedAt: Temporal.Now.instant() })
        .where(eq(davInstance.id, id))
        .then(() => undefined),
    catch: (e) => databaseError(e),
  });

export const InstanceRepositoryLive = Layer.effect(
  InstanceRepository,
  Effect.map(DatabaseClient, (db) =>
    InstanceRepository.of({
      findById: (id) => findById(db, id),
      findBySlug: (col, slug) => findBySlug(db, col, slug),
      listByCollection: (col) => listByCollection(db, col),
      insert: (input) => insertInstance(db, input),
      updateEtag: (id, etag, rev) => updateEtag(db, id, etag, rev),
      softDelete: (id) => softDelete(db, id),
    }),
  ),
);
