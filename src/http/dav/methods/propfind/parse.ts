// ---------------------------------------------------------------------------
// PROPFIND request-body parsing and instance body-data loading
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import { redactDocumentToBusyOnly } from "#src/data/icalendar/visibility.ts";
import { type ClarkName, cn, type IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import type {
	DatabaseError,
	DavError,
	XmlParseError,
} from "#src/domain/errors.ts";
import type { EntityId } from "#src/domain/ids.ts";
import type { PropfindKind } from "#src/http/dav/methods/instance-props.ts";
import { isXmlNode, xmlPath } from "#src/http/dav/methods/xml-node.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { ADDRESS_DATA, CALENDAR_DATA, DAV_NS } from "./ns.ts";

/** Reads the Clark names listed inside a `<D:prop>` or `<D:include>` element */
const propNames = (el: Record<string, unknown>): Set<ClarkName> =>
	new Set<ClarkName>(
		Object.keys(el).filter((k) => !k.startsWith("@_")) as Array<ClarkName>,
	);

/** Classifies a PROPFIND request document (RFC 4918 §9.1) */
const extractPropfindKind = (tree: unknown): PropfindKind => {
	const propfind = xmlPath(tree, cn(DAV_NS, "propfind"));
	if (propfind === undefined) {
		return { type: "allprop" };
	}
	if (cn(DAV_NS, "allprop") in propfind) {
		// RFC 4918 §9.1: allprop MAY be combined with <include> to request
		// properties not returned by default.
		const includeEl = propfind[cn(DAV_NS, "include")];
		return isXmlNode(includeEl)
			? { type: "allprop", extra: propNames(includeEl) }
			: { type: "allprop" };
	}
	if (cn(DAV_NS, "propname") in propfind) {
		return { type: "propname" };
	}
	const propEl = propfind[cn(DAV_NS, "prop")];
	return isXmlNode(propEl)
		? { type: "prop", names: propNames(propEl) }
		: { type: "allprop" };
};

// RFC 4918 §9.1: the PROPFIND body MUST be well-formed XML, so an XmlParseError
// propagates and the HTTP edge maps it to 400.
const parsePropfindDocument = (
	body: string,
): Effect.Effect<PropfindKind, XmlParseError> =>
	parseXml(body).pipe(
		Effect.map((raw) => extractPropfindKind(normalizeClarkNames(raw))),
	);

export const parsePropfindBody = (
	req: Request,
): Effect.Effect<PropfindKind, DavError | XmlParseError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) =>
			body.trim() === ""
				? Effect.succeed<PropfindKind>({ type: "allprop" })
				: parsePropfindDocument(body),
		),
	);

/**
 * RFC 4791 §9.6 — calendar collections (and inbox/outbox per RFC 6638 §2.3)
 * expose `{caldav}calendar-data`; RFC 6352 §10.4 — address-books expose
 * `{carddav}address-data`. Every other namespace carries no body-data.
 */
const DATA_CLARK_BY_NAMESPACE: Record<string, ClarkName | undefined> = {
	cal: CALENDAR_DATA,
	inbox: CALENDAR_DATA,
	outbox: CALENDAR_DATA,
	card: ADDRESS_DATA,
};

/** The body-data property an instance under this namespace exposes, if any */
export const dataClarkForNamespace = (
	namespace: string,
): Option.Option<ClarkName> =>
	Option.fromUndefinedOr(DATA_CLARK_BY_NAMESPACE[namespace]);

/** The entity kind a body-data property serializes */
export const entityTypeForDataClark = (
	dataClark: ClarkName,
): "vcard" | "icalendar" =>
	dataClark === ADDRESS_DATA ? "vcard" : "icalendar";

/** Wraps a loaded component tree as the document its entity kind names */
export const documentFor = (
	entityType: "vcard" | "icalendar",
	root: IrDocument["root"],
): IrDocument =>
	entityType === "icalendar"
		? { kind: "icalendar", root }
		: { kind: "vcard", root };

/**
 * If the PROPFIND request explicitly asks for the body-data property
 * (`<C:calendar-data/>` or `<CR:address-data/>`), load the instance's
 * component tree and emit the serialized body. RFC 4791 §9.6 / RFC 6352 §10.4
 * state these properties are NOT included in `allprop` responses — clients
 * must request them explicitly — so the load is skipped entirely for `allprop`
 * to avoid a per-instance fetch on a collection-wide enumeration.
 */
export const loadInstanceData = (
	row: InstanceRow,
	namespace: string,
	propfind: PropfindKind,
	redactToBusyOnly: boolean,
): Effect.Effect<Option.Option<string>, DatabaseError, ComponentRepository> =>
	Effect.gen(function* () {
		const dataClark = Option.getOrUndefined(dataClarkForNamespace(namespace));
		if (
			dataClark === undefined ||
			propfind.type !== "prop" ||
			!propfind.names.has(dataClark)
		) {
			return Option.none<string>();
		}
		const entityType = entityTypeForDataClark(dataClark);
		// Free-busy-only access has no meaning for CardDAV contacts — omit
		// address-data entirely rather than leak the full vCard.
		if (redactToBusyOnly && entityType !== "icalendar") {
			return Option.none<string>();
		}
		const compRepo = yield* ComponentRepository;
		const treeOpt = yield* compRepo.loadTree(
			row.entityId as unknown as EntityId,
			entityType,
		);
		if (Option.isNone(treeOpt)) {
			return Option.none<string>();
		}
		const loaded = documentFor(entityType, treeOpt.value);
		const doc = redactToBusyOnly ? redactDocumentToBusyOnly(loaded) : loaded;
		return Option.some(
			yield* entityType === "icalendar"
				? encodeICalendar(doc)
				: encodeVCard(doc),
		);
	});
