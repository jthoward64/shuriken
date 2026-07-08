import { Effect } from "effect";
import type { ClarkName, IrDeadProperties } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	forbidden,
	methodNotAllowed,
	unauthorized,
	unsupportedMediaType,
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
 * Locate the MKCOL request document element in a Clark-normalized tree.
 *
 * The root element is one of DAV:mkcol (plain extended MKCOL, RFC 5689 §3),
 * CALDAV:mkcalendar (MKCALENDAR, RFC 4791 §5.3.1), or CARDDAV:mkaddressbook
 * (MKADDRESSBOOK, RFC 6352 §5.3.1). Returns `undefined` for any other root —
 * RFC 5689 §3 reserves such bodies for future use, so the caller must reject
 * them with 415 (RFC 4918 §9.3) rather than silently creating a collection.
 */
const findMkcolRoot = (tree: unknown): Record<string, unknown> | undefined => {
	if (typeof tree !== "object" || tree === null) {
		return undefined;
	}
	const root = tree as Record<string, unknown>;
	const rootEl =
		root[`{${DAV_NS}}mkcol`] ??
		root[`{${CALDAV_NS}}mkcalendar`] ??
		root[`{${CARDDAV_NS}}mkaddressbook`];
	return typeof rootEl === "object" && rootEl !== null
		? (rootEl as Record<string, unknown>)
		: undefined;
};

/**
 * Extract displayName, description, and supportedComponents from the (already
 * located) MKCOL request document element.
 *
 * Each field defaults to `undefined` when absent — the individual extended-MKCOL
 * properties are optional per RFC 5689 §3.
 */
const extractMkcolProps = (rootEl: Record<string, unknown>): MkcolProps => {
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
 *
 * - Empty body → all-undefined props (the standard MKCOL form, RFC 4918 §9.3).
 * - Non-empty body with a recognized root (DAV:mkcol / CALDAV:mkcalendar /
 *   CARDDAV:mkaddressbook) → extracted props.
 * - Non-empty body that is not well-formed XML, or whose root element is not a
 *   recognized MKCOL request document → fails with 415 Unsupported Media Type.
 *   RFC 4918 §9.3: a MKCOL entity the server "does not support or understand…
 *   MUST respond with 415". RFC 5689 §3 reserves non-DAV:mkcol XML roots, so we
 *   reject them rather than silently creating an empty collection.
 *
 * Also propagates DavError from readXmlBody (e.g. 413 Too Large).
 */
const parseMkcolBody = (req: Request): Effect.Effect<MkcolProps, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) => {
			if (body.trim() === "") {
				return Effect.succeed(EMPTY_PROPS);
			}
			return parseXml(body).pipe(
				Effect.flatMap((parsed) => {
					const rootEl = findMkcolRoot(normalizeClarkNames(parsed));
					return rootEl === undefined
						? unsupportedMediaType()
						: Effect.succeed(extractMkcolProps(rootEl));
				}),
				Effect.catchTag("XmlParseError", () => unsupportedMediaType()),
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

		// Validate the request entity body before any resource-routing decision.
		// RFC 4918 §9.3: a MKCOL body the server cannot understand MUST yield 415,
		// and that is a property of the request entity independent of the target.
		// litmus basic/mkcol_with_body sends a junk body to a sub-collection path
		// (which shuriken cannot host) and requires 415 — so the body check must
		// run before the `path.kind` 405 below. An empty/valid body parses to
		// all-undefined props and falls through to the routing checks unchanged.
		const { displayName, description, supportedComponents, deadProps } =
			yield* parseMkcolBody(req);

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
