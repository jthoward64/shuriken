import { Data } from "effect";

// ---------------------------------------------------------------------------
// Trash errors — TrashService is a personal-ownership feature (not the DAV ACL
// system), so ownership is checked by direct `ownerPrincipalId` comparison and
// failures are reported as these two tagged errors rather than a DavError.
// The UI edge maps them to 404 / 403 respectively.
// ---------------------------------------------------------------------------

export class TrashNotFound extends Data.TaggedError("TrashNotFound")<{
	readonly resourceType: "collection" | "instance";
	readonly id: string;
}> {}

export class TrashNotOwner extends Data.TaggedError("TrashNotOwner")<{
	readonly resourceType: "collection" | "instance";
	readonly id: string;
}> {}
