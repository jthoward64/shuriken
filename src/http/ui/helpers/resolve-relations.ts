import { Effect, Match } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import type { ResolvedRelation } from "#src/http/ui/view/pages/contacts/relations.tsx";
import type { ContactRelation } from "#src/services/card-edit/types.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";

// ---------------------------------------------------------------------------
// Turn stored relations into something the viewer can render.
//
// A `RELATED:urn:uuid:…` names a contact by UID, which is meaningless on screen,
// so the UIDs are resolved against the card index in one query to get the
// target's current name and a link to it.
//
// A UID that resolves to nothing is not hidden: the reference is really in the
// vCard and will be written back on save. It falls back to the name recorded
// alongside the reference, or the raw UID when there is not even that — shown
// as muted text rather than a link that would 404.
// ---------------------------------------------------------------------------

export const resolveRelations = (
	relations: ReadonlyArray<ContactRelation>,
	collectionId: CollectionId,
): Effect.Effect<
	ReadonlyArray<ResolvedRelation>,
	DatabaseError,
	CardIndexRepository
> =>
	Effect.gen(function* () {
		const uids = relations.flatMap((r) =>
			r.target.kind === "contact" ? [r.target.uid] : [],
		);
		if (uids.length === 0) {
			return relations.map((relation) => ({
				relation,
				label: labelFor(relation),
			}));
		}

		const cardIndex = yield* CardIndexRepository;
		const rows = yield* cardIndex.findByUids(collectionId, uids);
		const byUid = new Map(
			rows.flatMap((r) => (r.uid === null ? [] : [[r.uid, r] as const])),
		);

		return relations.map((relation) => {
			if (relation.target.kind !== "contact") {
				return { relation, label: labelFor(relation) };
			}
			const found = byUid.get(relation.target.uid);
			if (found === undefined) {
				return { relation, label: labelFor(relation) };
			}
			return {
				relation,
				href: `/ui/contacts/${found.instanceId}`,
				// The target's live name, so a rename is reflected without touching
				// every card that points at it.
				label: found.fn ?? labelFor(relation),
			};
		});
	});

/** Display text with no directory lookup: the recorded name, else the target. */
const labelFor = (relation: ContactRelation): string => {
	if (relation.name !== "") {
		return relation.name;
	}
	return Match.value(relation.target).pipe(
		Match.discriminatorsExhaustive("kind")({
			contact: (target) => target.uid,
			email: (target) => target.address,
			text: () => "",
		}),
	);
};
