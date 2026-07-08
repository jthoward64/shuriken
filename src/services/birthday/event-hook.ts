import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import { CollectionRepository } from "#src/services/collection/index.ts";
import { BirthdayService } from "./service.ts";

// ---------------------------------------------------------------------------
// regenerateForAddressbook — reconcile the owner's Birthdays calendar right
// after a vCard write/delete, instead of waiting for the next scheduler tick
// (up to config.birthday.schedulerTickS, ~10 min by default). A no-op if the
// addressbook's owner has no auto-managed birthdays collection.
//
// Designed to be Effect.fork'd from vCard write paths (DAV PUT/DELETE,
// CardEditService, VCF import) so the response returns immediately while the
// reconcile happens in the background.
// ---------------------------------------------------------------------------

const regenerateForAddressbook = (
	addressbookId: CollectionId,
): Effect.Effect<
	void,
	DatabaseError | DavError | InternalError,
	BirthdayService | CollectionRepository
> =>
	Effect.gen(function* () {
		const collRepo = yield* CollectionRepository;
		const addressbookOpt = yield* collRepo.findById(addressbookId);
		if (Option.isNone(addressbookOpt)) {
			return;
		}
		const ownerPrincipalId = PrincipalId(addressbookOpt.value.ownerPrincipalId);
		const owned = yield* collRepo.listByOwner(ownerPrincipalId);
		const birthdaysColl = owned.find(
			(c) =>
				c.collectionType === "calendar" && c.autoManagedKind === "birthdays",
		);
		if (!birthdaysColl) {
			return;
		}
		const birthdaySvc = yield* BirthdayService;
		yield* birthdaySvc.regenerate(
			ownerPrincipalId,
			CollectionId(birthdaysColl.id),
		);
	});

/**
 * Convenience wrapper to forget errors so callers can `Effect.fork` the
 * reconcile without worrying about background failures bubbling up.
 */
export const fireAndForgetBirthdayRegenerate = (addressbookId: CollectionId) =>
	regenerateForAddressbook(addressbookId).pipe(
		Effect.catchCause((cause) =>
			Effect.logWarning("birthday.fireAndForgetRegenerate failed", { cause }),
		),
		Effect.forkDetach,
		Effect.asVoid,
	);
