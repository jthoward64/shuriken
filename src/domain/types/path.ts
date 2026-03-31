import { Brand } from "effect";
import type { CollectionId, InstanceId, PrincipalId } from "#/domain/ids.ts";

// ---------------------------------------------------------------------------
// Slug — raw URL path segment before UUID resolution
// ---------------------------------------------------------------------------

export type Slug = string & Brand.Brand<"Slug">;
export const Slug = Brand.nominal<Slug>();

// ---------------------------------------------------------------------------
// ResolvedDavPath — after slug→UUID resolution at the HTTP edge
// All internal code receives one of these; never a raw slug.
// ---------------------------------------------------------------------------

export type ResolvedDavPath =
	| {
			readonly kind: "wellknown";
			readonly name: "caldav" | "carddav";
	  }
	| {
			readonly kind: "principal";
			readonly principalId: PrincipalId;
	  }
	| {
			readonly kind: "collection";
			readonly principalId: PrincipalId;
			readonly collectionId: CollectionId;
	  }
	| {
			readonly kind: "instance";
			readonly principalId: PrincipalId;
			readonly collectionId: CollectionId;
			readonly instanceId: InstanceId;
	  };
