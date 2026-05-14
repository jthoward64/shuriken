import type { Effect } from "effect";
import { Context } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type {
	CollectionId,
	EntityId,
	InstanceId,
} from "#src/domain/ids.ts";
import type { ContactFormData } from "./types.ts";

// ---------------------------------------------------------------------------
// CardEditService — UI-side wrapper around vCard create/update/delete.
//
// The DAV PUT path already handles vCard text; this service exists so the
// browser form can post structured fields without round-tripping through a
// synthetic HTTP request. It owns:
//   * UID generation for new contacts
//   * Building the IrComponent VCARD from form data
//   * Persisting via Entity + Component + InstanceService.put
//
// Authorisation is NOT enforced here — UI handlers run AclService.check
// against the addressbook collection before invoking these methods.
// ---------------------------------------------------------------------------

export interface CardEditCreateResult {
	readonly entityId: EntityId;
	readonly instanceId: InstanceId;
	readonly slug: string;
	readonly uid: string;
}

export interface CardEditServiceShape {
	readonly create: (
		addressbookId: CollectionId,
		form: ContactFormData,
	) => Effect.Effect<
		CardEditCreateResult,
		DatabaseError | DavError | InternalError
	>;
	readonly update: (
		instanceId: InstanceId,
		form: ContactFormData,
	) => Effect.Effect<
		CardEditCreateResult,
		DatabaseError | DavError | InternalError
	>;
	readonly delete: (
		instanceId: InstanceId,
	) => Effect.Effect<void, DatabaseError | DavError | InternalError>;
}

export class CardEditService extends Context.Tag("CardEditService")<
	CardEditService,
	CardEditServiceShape
>() {}
