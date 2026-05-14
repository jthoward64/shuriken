import type { Effect } from "effect";
import { Context } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// BirthdayService — generates a yearly VEVENT for every BDAY-bearing contact
// in the user's addressbooks and reconciles those events into a single
// "Birthdays" calendar collection.
//
// `regenerate` is the only entry point: a full replace driven by current
// card_index state. The intended call sites are
//   1. on-demand from the UI (force refresh)
//   2. from a write hook fired after vCard inserts/updates/deletes
//   3. one-off at user provisioning, once the Birthdays collection exists
// All three end up calling the same diff-and-upsert routine; idempotency
// comes from the deterministic UID derivation in `build-event.ts`.
// ---------------------------------------------------------------------------

export interface BirthdayServiceShape {
	/**
	 * Reconcile every VEVENT in `targetCollectionId` against the live BDAY
	 * data in `principalId`'s addressbooks. Inserts new birthdays, replaces
	 * the component tree on existing UIDs when content changed, and deletes
	 * any prior birthday whose source card lost its BDAY (or was removed).
	 */
	readonly regenerate: (
		principalId: PrincipalId,
		targetCollectionId: CollectionId,
	) => Effect.Effect<
		{
			readonly inserted: number;
			readonly updated: number;
			readonly deleted: number;
		},
		DatabaseError | DavError | InternalError
	>;
}

export class BirthdayService extends Context.Tag("BirthdayService")<
	BirthdayService,
	BirthdayServiceShape
>() {}
