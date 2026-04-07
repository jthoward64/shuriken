import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, methodNotAllowed } from "#src/domain/errors.ts";
import { NAMESPACE_TO_COLLECTION_TYPE } from "#src/domain/types/collection-namespace.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
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
}

const EMPTY_PROPS: MkcolProps = {
	displayName: undefined,
	description: undefined,
	supportedComponents: undefined,
};

/**
 * Extract displayName, description, and supportedComponents from a
 * Clark-normalized fast-xml-parser tree.
 *
 * All fields default to `undefined` when the body is absent or malformed —
 * the extended-MKCOL body is optional per RFC 5689 §5.
 */
const extractMkcolProps = (tree: unknown): MkcolProps => {
	if (typeof tree !== "object" || tree === null) { return EMPTY_PROPS; }

	const root = tree as Record<string, unknown>;

	// The root element may be any of these depending on the HTTP method
	const rootEl = (root[`{${DAV_NS}}mkcol`] ??
		root[`{${CALDAV_NS}}mkcalendar`] ??
		root[`{${CARDDAV_NS}}mkaddressbook`]) as
		| Record<string, unknown>
		| undefined;

	if (typeof rootEl !== "object" || rootEl === null) { return EMPTY_PROPS; }

	const set = rootEl[`{${DAV_NS}}set`] as
		| Record<string, unknown>
		| undefined;
	if (typeof set !== "object" || set === null) { return EMPTY_PROPS; }

	const prop = set[`{${DAV_NS}}prop`] as
		| Record<string, unknown>
		| undefined;
	if (typeof prop !== "object" || prop === null) { return EMPTY_PROPS; }

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

	return { displayName, description, supportedComponents };
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
				Effect.map((parsed) =>
					extractMkcolProps(normalizeClarkNames(parsed)),
				),
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
): Effect.Effect<Response, DavError | DatabaseError, CollectionService | AclService> =>
	Effect.gen(function* () {
		if (path.kind !== "new-collection") {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* forbidden("DAV:need-privileges");
		}
		const principal = ctx.auth.principal;

		const collectionType = NAMESPACE_TO_COLLECTION_TYPE[path.namespace];

		const acl = yield* AclService;
		yield* acl.check(
			principal.principalId,
			path.principalId,
			"principal",
			"DAV:bind",
		);

		const { displayName, description, supportedComponents } =
			yield* parseMkcolBody(req);

		const collectionSvc = yield* CollectionService;
		const collectionRow = yield* collectionSvc.create({
			ownerPrincipalId: path.principalId,
			collectionType,
			slug: path.slug,
			displayName,
			description,
			supportedComponents: supportedComponents as Array<string> | undefined,
		});

		const location = `${ctx.url.origin}/dav/principals/${path.principalId}/${path.namespace}/${collectionRow.id}/`;

		return new Response(null, {
			status: HTTP_CREATED,
			// biome-ignore lint/style/useNamingConvention: HTTP header name
			headers: { Location: location },
		});
	});
