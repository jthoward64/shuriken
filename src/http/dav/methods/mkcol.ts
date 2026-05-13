import { Effect } from "effect";
import type { ClarkName, IrDeadProperties } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	forbidden,
	methodNotAllowed,
	unauthorized,
} from "#src/domain/errors.ts";
import { CollectionId } from "#src/domain/ids.ts";
import { NAMESPACE_TO_COLLECTION_TYPE } from "#src/domain/types/collection-namespace.ts";
import { isValidSlug, type ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { HTTP_CREATED } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";

// ---------------------------------------------------------------------------
// Namespace URIs referenced in the extended-MKCOL body (RFC 5689)
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";

// ---------------------------------------------------------------------------
// Extended-MKCOL body parsing
// ---------------------------------------------------------------------------

interface MkcolProps {
	readonly displayName: string | undefined;
	readonly description: string | undefined;
	readonly supportedComponents: ReadonlyArray<string> | undefined;
	/** Dead properties from <D:set><D:prop> not consumed by the live-prop fields above. */
	readonly deadProps: IrDeadProperties;
}

const EMPTY_PROPS: MkcolProps = {
	displayName: undefined,
	description: undefined,
	supportedComponents: undefined,
	deadProps: {} as IrDeadProperties,
};

/**
 * Clark-formatted keys of properties that MKCOL/MKCALENDAR/MKADDRESSBOOK
 * consume as live fields — these must NOT be stored as dead properties.
 * (resourcetype is protected; the others map to typed columns.)
 */
const LIVE_PROP_KEYS: ReadonlySet<string> = new Set([
	`{${DAV_NS}}displayname`,
	`{${DAV_NS}}resourcetype`,
	`{${CALDAV_NS}}calendar-description`,
	`{${CARDDAV_NS}}addressbook-description`,
	`{${CALDAV_NS}}supported-calendar-component-set`,
]);

/**
 * Extract displayName, description, and supportedComponents from a
 * Clark-normalized fast-xml-parser tree.
 *
 * All fields default to `undefined` when the body is absent or malformed —
 * the extended-MKCOL body is optional per RFC 5689 §5.
 */
const extractMkcolProps = (tree: unknown): MkcolProps => {
	if (typeof tree !== "object" || tree === null) {
		return EMPTY_PROPS;
	}

	const root = tree as Record<string, unknown>;

	// The root element may be any of these depending on the HTTP method
	const rootEl = (root[`{${DAV_NS}}mkcol`] ??
		root[`{${CALDAV_NS}}mkcalendar`] ??
		root[`{${CARDDAV_NS}}mkaddressbook`]) as
		| Record<string, unknown>
		| undefined;

	if (typeof rootEl !== "object" || rootEl === null) {
		return EMPTY_PROPS;
	}

	const set = rootEl[`{${DAV_NS}}set`] as Record<string, unknown> | undefined;
	if (typeof set !== "object" || set === null) {
		return EMPTY_PROPS;
	}

	const prop = set[`{${DAV_NS}}prop`] as Record<string, unknown> | undefined;
	if (typeof prop !== "object" || prop === null) {
		return EMPTY_PROPS;
	}

	const displayName =
		typeof prop[`{${DAV_NS}}displayname`] === "string"
			? (prop[`{${DAV_NS}}displayname`] as string)
			: undefined;

	const calDesc = prop[`{${CALDAV_NS}}calendar-description`];
	const cardDesc = prop[`{${CARDDAV_NS}}addressbook-description`];
	const description =
		typeof calDesc === "string"
			? calDesc
			: typeof cardDesc === "string"
				? cardDesc
				: undefined;

	let supportedComponents: ReadonlyArray<string> | undefined;
	const scs = prop[`{${CALDAV_NS}}supported-calendar-component-set`] as
		| Record<string, unknown>
		| undefined;
	if (typeof scs === "object" && scs !== null) {
		const compKey = `{${CALDAV_NS}}comp`;
		const comps = scs[compKey];
		const compsArr = Array.isArray(comps)
			? comps
			: comps !== undefined
				? [comps]
				: [];
		const names: Array<string> = [];
		for (const comp of compsArr) {
			if (typeof comp === "object" && comp !== null) {
				const name = (comp as Record<string, unknown>)["@_name"];
				if (typeof name === "string") {
					names.push(name);
				}
			}
		}
		if (names.length > 0) {
			supportedComponents = names;
		}
	}

	// Anything in <D:set><D:prop> that we didn't recognise above is treated as
	// a dead property — RFC 5689 §3 lets MKCOL bodies carry any property at
	// all, and clients (Apple Calendar, DAVx5, …) routinely include
	// {http://apple.com/ns/ical/}calendar-color here. Discarding them silently
	// forces clients to follow MKCOL with a PROPPATCH for every common case.
	const deadProps: Record<ClarkName, unknown> = {};
	for (const [key, value] of Object.entries(prop)) {
		if (key.startsWith("@_")) {
			continue;
		}
		if (LIVE_PROP_KEYS.has(key)) {
			continue;
		}
		deadProps[key as ClarkName] = value;
	}

	return {
		displayName,
		description,
		supportedComponents,
		deadProps: deadProps as IrDeadProperties,
	};
};

/**
 * Read and parse the optional extended-MKCOL request body.
 * Returns all-undefined props for empty or malformed bodies (RFC 5689 §5).
 * Only propagates DavError from readXmlBody (e.g. 413 Too Large).
 */
const parseMkcolBody = (req: Request): Effect.Effect<MkcolProps, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) => {
			if (body.trim() === "") {
				return Effect.succeed(EMPTY_PROPS);
			}
			return parseXml(body).pipe(
				Effect.map((parsed) => extractMkcolProps(normalizeClarkNames(parsed))),
				Effect.catchTag("XmlParseError", () => Effect.succeed(EMPTY_PROPS)),
			);
		}),
	);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Handles MKCOL, MKCALENDAR, and MKADDRESSBOOK (RFC 4918 §9.3, RFC 5689). */
export const mkcolHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	CollectionService | AclService
> =>
	Effect.gen(function* () {
		// Auth gate first — defense in depth alongside the central davRouter gate.
		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const principal = ctx.auth.principal;

		if (path.kind !== "new-collection") {
			return yield* methodNotAllowed();
		}

		// Slug validation — reject collection names containing whitespace,
		// path traversal sequences, or characters that would require encoding
		// in subsequent responses. Done at creation time so the existing-row
		// fast-paths in parseDavPath can stay simple.
		if (!isValidSlug(path.slug)) {
			return yield* forbidden();
		}

		const collectionType = NAMESPACE_TO_COLLECTION_TYPE[path.namespace];

		const acl = yield* AclService;
		yield* acl.check(
			principal.principalId,
			path.principalId,
			"principal",
			"DAV:bind",
		);

		const { displayName, description, supportedComponents, deadProps } =
			yield* parseMkcolBody(req);

		const collectionSvc = yield* CollectionService;
		const newCollection = yield* collectionSvc.create({
			ownerPrincipalId: path.principalId,
			collectionType,
			slug: path.slug,
			displayName,
			description,
			supportedComponents: supportedComponents as Array<string> | undefined,
		});

		// RFC 5689 §3: the MKCOL body's `<D:set>` is a single atomic operation.
		// Persist any unrecognised properties as dead props so e.g. Apple's
		// {ical}calendar-color set at MKCALENDAR time survives subsequent
		// PROPFIND requests.
		if (Object.keys(deadProps).length > 0) {
			yield* collectionSvc.updateProperties(CollectionId(newCollection.id), {
				clientProperties: deadProps,
			});
		}

		const location = `${ctx.url.origin}/dav/principals/${path.principalSeg}/${path.namespace}/${path.slug}/`;

		return new Response(null, {
			status: HTTP_CREATED,
			headers: { Location: location },
		});
	});
