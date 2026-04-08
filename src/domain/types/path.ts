import { Brand } from "effect";
import type {
	CollectionId,
	GroupId,
	InstanceId,
	PrincipalId,
	UserId,
} from "#src/domain/ids.ts";
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
	  }
	| {
			/** /dav/users/ — the admin user collection */
			readonly kind: "userCollection";
	  }
	| {
			/** /dav/users/:seg — a single managed user */
			readonly kind: "user";
			readonly principalId: PrincipalId;
			readonly userId: UserId;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly userSeg: string;
	  }
	| {
			/** /dav/users/:seg — path segment that does not resolve to an existing user */
			readonly kind: "newUser";
			readonly slug: Slug;
	  }
	| {
			/** /dav/groups/ — the admin group collection */
			readonly kind: "groupCollection";
	  }
	| {
			/** /dav/groups/:seg — a single managed group */
			readonly kind: "group";
			readonly principalId: PrincipalId;
			readonly groupId: GroupId;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly groupSeg: string;
	  }
	| {
			/** /dav/groups/:seg — path segment that does not resolve to an existing group */
			readonly kind: "newGroup";
			readonly slug: Slug;
	  }
	| {
			/** /dav/groups/:seg/members/ — the member sub-collection of a group */
			readonly kind: "groupMembers";
			readonly principalId: PrincipalId;
			readonly groupId: GroupId;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly groupSeg: string;
	  }
	| {
			/** /dav/groups/:seg/members/:memberSeg — a resolved group membership */
			readonly kind: "groupMember";
			readonly principalId: PrincipalId;
			readonly groupId: GroupId;
			readonly memberUserId: UserId;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly groupSeg: string;
			/** URL-decoded path segment as the client sent it (slug or UUID string). */
			readonly memberSeg: string;
	  }
	| {
			/** /dav/groups/:seg/members/:memberSeg — member slug that does not resolve */
			readonly kind: "newGroupMember";
			readonly principalId: PrincipalId;
			readonly groupId: GroupId;
			readonly groupSeg: string;
			readonly slug: Slug;
	  };
