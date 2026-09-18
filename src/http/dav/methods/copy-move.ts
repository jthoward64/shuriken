import { Effect } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	type DatabaseError,
	type DavError,
	davError,
} from "#src/domain/errors.ts";
import {
	type CollectionId,
	EntityId,
	InstanceId,
	type PrincipalId,
} from "#src/domain/ids.ts";
import { HTTP_BAD_REQUEST } from "#src/http/status.ts";
import { CollectionRepository } from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceRepository } from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";

// ---------------------------------------------------------------------------
// Shared header parsing utilities for COPY and MOVE (RFC 4918 §10)
// ---------------------------------------------------------------------------

/**
 * Parse the required Destination header into a URL.
 * Fails with 400 Bad Request if the header is absent or malformed.
 */
/** What a COPY/MOVE worker needs about the request beyond the source path. */
export interface CopyMoveRequest {
	readonly principalId: PrincipalId;
	readonly destUrl: URL;
	readonly overwrite: boolean;
	readonly req: Request;
}

export const parseDestination = (req: Request): Effect.Effect<URL, DavError> =>
	Effect.gen(function* () {
		const raw = req.headers.get("Destination");
		if (raw === null) {
			return yield* Effect.fail(
				davError(HTTP_BAD_REQUEST, undefined, "Missing Destination header"),
			);
		}
		return yield* Effect.try({
			try: () => new URL(raw),
			catch: () =>
				davError(HTTP_BAD_REQUEST, undefined, "Malformed Destination header"),
		});
	});

/**
 * Parse the optional Overwrite header (RFC 4918 §10.6).
 * Returns true for "T" (default when absent), false for "F".
 * Case-insensitive; any unrecognised value is treated as "T".
 */
export const parseOverwrite = (req: Request): boolean => {
	const raw = req.headers.get("Overwrite");
	if (raw === null) {
		return true;
	}
	return raw.trim().toUpperCase() !== "F";
};

// Depth values COPY/MOVE accept, keyed by their lowercased header spelling
const ACCEPTED_DEPTHS: Record<string, "0" | "infinity" | undefined> = {
	"0": "0",
	infinity: "infinity",
};

/**
 * Parse the optional Depth header (RFC 4918 §10.2).
 * Only "0" and "infinity" are accepted for COPY/MOVE; "1" is not valid.
 * Fails with 400 if an unrecognised value is present.
 *
 * @param defaultDepth The depth to use when the header is absent.
 */
export const parseDepth = (
	req: Request,
	defaultDepth: "0" | "infinity",
): Effect.Effect<"0" | "infinity", DavError> => {
	const raw = req.headers.get("Depth");
	if (raw === null) {
		return Effect.succeed(defaultDepth);
	}
	const depth = ACCEPTED_DEPTHS[raw.trim().toLowerCase()];
	return depth === undefined
		? Effect.fail(
				davError(
					HTTP_BAD_REQUEST,
					undefined,
					`Invalid Depth header value: ${raw}`,
				),
			)
		: Effect.succeed(depth);
};

// ---------------------------------------------------------------------------
// Shared deletion helpers (used by DELETE, COPY overwrite, MOVE overwrite)
// ---------------------------------------------------------------------------

/**
 * Soft-delete a single instance and its backing entity + component tree.
 * The instance soft-delete fires the DB trigger that creates a tombstone for
 * RFC 6578 sync-collection delta sync.
 */
// Soft-delete the instance first so the DB tombstone trigger fires while the
// entity is still logically present
const softDeleteInstanceTree = (
	instance: InstanceRow,
): Effect.Effect<
	void,
	DatabaseError,
	InstanceRepository | EntityRepository | ComponentRepository
> =>
	Effect.gen(function* () {
		const instanceRepo = yield* InstanceRepository;
		const entityRepo = yield* EntityRepository;
		const componentRepo = yield* ComponentRepository;
		yield* instanceRepo.softDelete(InstanceId(instance.id));
		yield* entityRepo.softDelete(EntityId(instance.entityId));
		yield* componentRepo.deleteByEntity(EntityId(instance.entityId));
	});

export const deleteInstance = (
	instance: InstanceRow,
): Effect.Effect<
	void,
	DatabaseError,
	InstanceRepository | EntityRepository | ComponentRepository | DatabaseClient
> =>
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		yield* withTransaction(softDeleteInstanceTree(instance)).pipe(
			Effect.provideService(DatabaseClient, db),
		);
	});

/**
 * Soft-delete all instances in a collection and then the collection itself.
 * Used when overwriting a collection destination and for collection DELETE.
 */
export const deleteCollection = (
	collectionId: CollectionId,
): Effect.Effect<
	void,
	DatabaseError,
	| InstanceRepository
	| CollectionRepository
	| EntityRepository
	| ComponentRepository
	| DatabaseClient
> =>
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const instanceRepo = yield* InstanceRepository;
		const instances = yield* instanceRepo.listByCollection(collectionId);
		const collectionRepo = yield* CollectionRepository;
		yield* withTransaction(
			Effect.forEach(instances, deleteInstance, { discard: true }).pipe(
				Effect.andThen(collectionRepo.softDelete(collectionId)),
			),
		).pipe(Effect.provideService(DatabaseClient, db));
	});
