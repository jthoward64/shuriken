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
	if (typeof tree !== "object" || tree === null) {
		return EMPTY_PROPS;
	}
	const root = tree as Record<string, unknown>;
	const rootEl = root[`{${DAV_NS}}mkcol`] as
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
			: typeof prop[`{${SHURIKEN_NS}}displayname`] === "string"
				? (prop[`{${SHURIKEN_NS}}displayname`] as string)
				: undefined;

	return { displayName };
};

const parseBody = (req: Request): Effect.Effect<GroupMkcolProps, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) => {
			if (body.trim() === "") {
				return Effect.succeed(EMPTY_PROPS);
			}
			return parseXml(body).pipe(
				Effect.map((parsed) => extractProps(normalizeClarkNames(parsed))),
				Effect.catchTag("XmlParseError", () => Effect.succeed(EMPTY_PROPS)),
			);
		}),
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
