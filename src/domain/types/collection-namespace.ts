import { type Option, Schema } from "effect";

// ---------------------------------------------------------------------------
// CollectionNamespace — the URL path segment that identifies the type of
// collection being addressed.
//
// URL structure: /dav/principals/:principal/:namespace/:collection[/:instance]
//
// Each namespace maps 1:1 to a `collectionType` value in the database,
// allowing slugs to be reused across different collection types under the
// same principal (e.g. a "primary" calendar and a "primary" address book).
// ---------------------------------------------------------------------------

export const CollectionNamespaceSchema = Schema.Literal(
	"cal",
	"card",
	"inbox",
	"outbox",
	"col",
);

export type CollectionNamespace = Schema.Schema.Type<
	typeof CollectionNamespaceSchema
>;

export const NAMESPACE_TO_COLLECTION_TYPE = {
	cal: "calendar",
	card: "addressbook",
	inbox: "inbox",
	outbox: "outbox",
	col: "collection",
} as const satisfies Record<CollectionNamespace, string>;

export const COLLECTION_TYPE_TO_NAMESPACE = {
	calendar: "cal",
	addressbook: "card",
	inbox: "inbox",
	outbox: "outbox",
	collection: "col",
} as const satisfies Record<string, CollectionNamespace>;

/**
 * Parse a raw URL segment into a CollectionNamespace.
 * Returns None for any unrecognised segment.
 */
const decodeNamespace = Schema.decodeUnknownOption(CollectionNamespaceSchema);

export const parseCollectionNamespace = (
	segment: string,
): Option.Option<CollectionNamespace> => decodeNamespace(segment);
