import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, InstanceId, PrincipalId } from "#src/domain/ids.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import type { TrashNotFound, TrashNotOwner } from "./error.ts";

// ---------------------------------------------------------------------------
// TrashService — business logic for the trash bin (soft-delete recovery).
//
// Ownership is a plain `ownerPrincipalId` comparison — this is a personal
// convenience feature layered on top of soft-delete, not part of the DAV ACL
// model, so it deliberately does not consult AclService.
// ---------------------------------------------------------------------------

export interface TrashListing {
	readonly collections: ReadonlyArray<CollectionRow>;
	readonly instances: ReadonlyArray<InstanceRow>;
}

export interface TrashServiceShape {
	/**
	 * Every soft-deleted collection the principal owns, plus every soft-deleted
	 * instance under any collection (deleted or still active) the principal
	 * owns. The two lists are flat/unassociated — callers that want to group
	 * instances under their parent collection name can join on `collectionId`.
	 */
	readonly listTrash: (
		ownerPrincipalId: PrincipalId,
	) => Effect.Effect<TrashListing, DatabaseError>;
	readonly restoreCollection: (
		id: CollectionId,
		callerPrincipalId: PrincipalId,
	) => Effect.Effect<
		CollectionRow,
		DatabaseError | TrashNotFound | TrashNotOwner
	>;
	readonly restoreInstance: (
		id: InstanceId,
		callerPrincipalId: PrincipalId,
	) => Effect.Effect<
		InstanceRow,
		DatabaseError | TrashNotFound | TrashNotOwner
	>;
	readonly purgeCollectionForever: (
		id: CollectionId,
		callerPrincipalId: PrincipalId,
	) => Effect.Effect<void, DatabaseError | TrashNotFound | TrashNotOwner>;
	readonly purgeInstanceForever: (
		id: InstanceId,
		callerPrincipalId: PrincipalId,
	) => Effect.Effect<void, DatabaseError | TrashNotFound | TrashNotOwner>;
}

export class TrashService extends Context.Service<
	TrashService,
	TrashServiceShape
>()("TrashService") {}
