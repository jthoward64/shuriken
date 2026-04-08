import { Effect } from "effect";
import {
	type DatabaseError,
	type DavError,
	davError,
} from "#src/domain/errors.ts";
import { EntityId, InstanceId, type CollectionId } from "#src/domain/ids.ts";
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
	const normalised = raw.trim().toLowerCase();
	if (normalised === "0") {
		return Effect.succeed("0");
	}
	if (normalised === "infinity") {
		return Effect.succeed("infinity");
	}
	return Effect.fail(
		davError(HTTP_BAD_REQUEST, undefined, `Invalid Depth header value: ${raw}`),
	);
};

// ---------------------------------------------------------------------------
// Shared deletion helpers (used by DELETE, COPY overwrite, MOVE overwrite)
// ---------------------------------------------------------------------------

/**
 * Soft-delete a single instance and its backing entity + component tree.
 * The instance soft-delete fires the DB trigger that creates a tombstone for
 * RFC 6578 sync-collection delta sync.
 */
export const deleteInstance = (
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

		// Soft-delete instance first so the DB tombstone trigger fires while the
		// entity is still logically present.
		yield* instanceRepo.softDelete(InstanceId(instance.id));
		yield* entityRepo.softDelete(EntityId(instance.entityId));
		yield* componentRepo.deleteByEntity(EntityId(instance.entityId));
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
> =>
	Effect.gen(function* () {
		const instanceRepo = yield* InstanceRepository;
		const instances = yield* instanceRepo.listByCollection(collectionId);
		yield* Effect.forEach(instances, deleteInstance, { discard: true });

		const collectionRepo = yield* CollectionRepository;
		yield* collectionRepo.softDelete(collectionId);
	});
