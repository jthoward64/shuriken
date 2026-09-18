import { Effect } from "effect";
import type {
	ConflictError,
	DatabaseError,
	DavError,
} from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	SHURIKEN_NS,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { xmlPath, xmlText } from "#src/http/dav/methods/xml-node.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { HTTP_CREATED } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";

// ---------------------------------------------------------------------------
// MKCOL body parsing
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";

interface GroupMkcolProps {
	readonly displayName: string | undefined;
}

const EMPTY_PROPS: GroupMkcolProps = { displayName: undefined };

const extractProps = (tree: unknown): GroupMkcolProps => {
	const prop = xmlPath(
		tree,
		`{${DAV_NS}}mkcol`,
		`{${DAV_NS}}set`,
		`{${DAV_NS}}prop`,
	);
	if (prop === undefined) {
		return EMPTY_PROPS;
	}
	// The shuriken-namespaced name is accepted as a fallback for older clients
	return {
		displayName:
			xmlText(prop, `{${DAV_NS}}displayname`) ??
			xmlText(prop, `{${SHURIKEN_NS}}displayname`),
	};
};

// Malformed XML is treated as an empty body rather than a hard failure
const parseProps = (body: string): Effect.Effect<GroupMkcolProps> =>
	parseXml(body).pipe(
		Effect.map((parsed) => extractProps(normalizeClarkNames(parsed))),
		Effect.catchTag("XmlParseError", () => Effect.succeed(EMPTY_PROPS)),
	);

const parseBody = (req: Request): Effect.Effect<GroupMkcolProps, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) =>
			body.trim() === "" ? Effect.succeed(EMPTY_PROPS) : parseProps(body),
		),
	);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Handles MKCOL /dav/groups/:slug — creates a new group principal. */
export const groupMkcolHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError | ConflictError,
	AclService | GroupService
> =>
	Effect.gen(function* () {
		if (path.kind !== "newGroup") {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const requester = ctx.auth.principal;

		const acl = yield* AclService;
		yield* acl.check(
			requester.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:bind",
		);

		const { displayName } = yield* parseBody(req);

		const groupSvc = yield* GroupService;
		yield* groupSvc.create({
			slug: path.slug as Slug,
			displayName,
		});

		const location = `${ctx.url.origin}/dav/groups/${path.slug}/`;
		return new Response(null, {
			status: HTTP_CREATED,
			headers: { Location: location },
		});
	});
