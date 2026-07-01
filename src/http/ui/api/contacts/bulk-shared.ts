import { Effect } from "effect";
import { InternalError } from "#src/domain/errors.ts";
import { InstanceId, isUuid } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// Shared parsing for the contacts-list bulk-action form.
//
// The list renders one checkbox per contact named `id` (value = instance UUID)
// plus a hidden `addressbook` field so we can redirect back to the right book.
// ---------------------------------------------------------------------------

export interface BulkSelection {
	readonly ids: ReadonlyArray<InstanceId>;
	readonly addressbook: string;
}

export const parseBulkSelection = (
	req: Request,
): Effect.Effect<BulkSelection, InternalError> =>
	Effect.gen(function* () {
		const formData = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});
		const ids = formData
			.getAll("id")
			.filter((v): v is string => typeof v === "string")
			.filter(isUuid)
			.map(InstanceId);
		const rawBook = formData.get("addressbook");
		const addressbook = typeof rawBook === "string" ? rawBook : "";
		return { ids, addressbook };
	});

/** The contacts-list URL to return to after a bulk mutation. */
export const contactsRedirect = (addressbook: string): string =>
	addressbook === ""
		? "/ui/contacts"
		: `/ui/contacts?addressbook=${encodeURIComponent(addressbook)}`;
