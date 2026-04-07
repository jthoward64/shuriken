import { Brand } from "effect";
import type { CollectionId, InstanceId, PrincipalId } from "#src/domain/ids.ts";
import type { CollectionNamespace } from "#src/domain/types/collection-namespace.ts";

// ---------------------------------------------------------------------------
// ResourceUrl — absolute DAV resource URL used in ACL rules
// ---------------------------------------------------------------------------

export type ResourceUrl = string & Brand.Brand<"ResourceUrl">;
export const ResourceUrl = Brand.nominal<ResourceUrl>();

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
			/** /.well-known/caldav or /.well-known/carddav */
			readonly kind: "wellknown";
			readonly name: "caldav" | "carddav";
	  }
	| {
			/** /dav/ — the root DAV collection */
			readonly kind: "root";
	  }
	| {
			/** /dav/principals/ — the principal-collection listing */
			readonly kind: "principalCollection";
	  }
	| {
			/** /dav/principals/:seg — a single principal home */
			readonly kind: "principal";
			readonly principalId: PrincipalId;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly principalSeg: string;
	  }
	| {
			/** /dav/principals/:seg/:ns/:collSeg — a calendar/addressbook collection */
			readonly kind: "collection";
			readonly principalId: PrincipalId;
			readonly namespace: CollectionNamespace;
			readonly collectionId: CollectionId;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly principalSeg: string;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly collectionSeg: string;
	  }
	| {
			/** /dav/principals/:seg/:ns/:collSeg/:instSeg — a single calendar/vCard resource */
			readonly kind: "instance";
			readonly principalId: PrincipalId;
			readonly namespace: CollectionNamespace;
			readonly collectionId: CollectionId;
			readonly instanceId: InstanceId;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly principalSeg: string;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly collectionSeg: string;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly instanceSeg: string;
	  }
	| {
			readonly kind: "new-collection";
			readonly principalId: PrincipalId;
			readonly namespace: CollectionNamespace;
			readonly slug: Slug;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly principalSeg: string;
	  }
	| {
			readonly kind: "new-instance";
			readonly principalId: PrincipalId;
			readonly namespace: CollectionNamespace;
			readonly collectionId: CollectionId;
			readonly slug: Slug;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly principalSeg: string;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly collectionSeg: string;
	  };
