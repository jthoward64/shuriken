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

/**
 * Validate the shape of a client-supplied URL path segment that will be stored
 * as a collection / instance / user / group slug.
 *
 * Constraints (deliberately tighter than RFC 3986 unreserved so we don't have
 * to think about URL-encoding in storage or response hrefs):
 *   - 1..128 ASCII chars
 *   - Letters, digits, `_`, `-`, `.`
 *   - May not start or end with `.` (avoids `..` traversal-shaped slugs)
 *
 * Returns `true` if the segment is a safe slug. Used at the HTTP edge to gate
 * new-resource creation; existing rows are not re-validated.
 */
const SLUG_RE =
	/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,126}[A-Za-z0-9_-]$|^[A-Za-z0-9_-]$/;

export const isValidSlug = (s: string): boolean => SLUG_RE.test(s);

/**
 * Validate a calendar/contact *object* (instance) resource name.
 *
 * Deliberately looser than {@link isValidSlug}: real clients name objects after
 * their UID, which is overwhelmingly `local@domain` (e.g.
 * `20010712T182145Z-123401@example.com.ics`). The tight collection-slug charset
 * rejects `@` and would 403 those PUTs — a serious interoperability bug (see
 * documentation/planning/finding-instance-slug-charset.md).
 *
 * We accept the RFC 3986 `pchar` set minus `/` — unreserved + sub-delims +
 * `:`/`@` — which is everything legal in a single path segment. Anything stored
 * is re-encoded with `encodeSegment` when emitted in an href, so a permissive
 * input charset never produces an unsafe URL. `.`/`..` are rejected (they carry
 * special meaning in a URL path); `/` and control characters are excluded by
 * the character class.
 */
const INSTANCE_SLUG_RE = /^[A-Za-z0-9._~!$&'()*+,;=:@-]{1,128}$/;

export const isValidInstanceSlug = (s: string): boolean =>
	s !== "." && s !== ".." && INSTANCE_SLUG_RE.test(s);

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
			/**
			 * /dav/principals/:seg/:ns — the per-type *home* collection (e.g. the
			 * calendar home at `/cal/`, addressbook home at `/card/`). RFC 4918 §5.2
			 * requires every ancestor of an addressable resource to be a collection,
			 * so the namespace level is a real, enumerable collection whose members
			 * are the typed collections beneath it. Advertised to clients via
			 * {CALDAV}calendar-home-set / {CARDDAV}addressbook-home-set.
			 */
			readonly kind: "collectionHome";
			readonly principalId: PrincipalId;
			readonly namespace: CollectionNamespace;
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
			readonly kind: "groupMemberNonExistent";
			readonly principalId: PrincipalId;
			readonly groupId: GroupId;
			readonly groupSeg: string;
			readonly slug: Slug;
	  }
	| {
			/**
			 * /dav/principals/:seg or any deeper path where the principal does not
			 * exist.  Handlers that would *create* a resource (MKCOL, MKCALENDAR, PUT)
			 * MUST return 409 Conflict per RFC 4918 §9.3.1 / §9.7 (missing intermediate
			 * collection).  All other methods return 404.
			 */
			readonly kind: "unknownPrincipal";
			readonly principalSeg: string;
	  };
