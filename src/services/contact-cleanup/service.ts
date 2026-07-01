import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { CollectionId, InstanceId } from "#src/domain/ids.ts";
import type { CleanupFix, CleanupSuggestion } from "./types.ts";

// ---------------------------------------------------------------------------
// ContactCleanupService — scans an addressbook for messy contact data and
// applies individual fixes to a vCard's IR.
//
// Analysis is a set of pure functions (see analyze*.ts); this service wires
// them to the read path and owns the write-back. Fixes are applied surgically
// at the IR level so unrelated vCard properties are preserved.
//
// Authorisation is NOT enforced here — UI handlers run AclService.check against
// the addressbook collection before invoking these methods.
// ---------------------------------------------------------------------------

export interface ContactCleanupServiceShape {
	readonly scan: (
		collectionId: CollectionId,
		region: string,
	) => Effect.Effect<
		ReadonlyArray<CleanupSuggestion>,
		DatabaseError | DavError
	>;
	readonly applyFix: (
		instanceId: InstanceId,
		fix: CleanupFix,
	) => Effect.Effect<void, DatabaseError | DavError>;
}

export class ContactCleanupService extends Context.Service<
	ContactCleanupService,
	ContactCleanupServiceShape
>()("ContactCleanupService") {}
