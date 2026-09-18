import { Effect, Option } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import type { ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	SHURIKEN_NS,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	isXmlNode,
	xmlPath,
	xmlText,
} from "#src/http/dav/methods/xml-node.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import { UserService } from "#src/services/user/index.ts";

const USER_HREF = /\/dav\/users\/([^/]+)\/?$/u;

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";

interface ProppatchUpdates {
	readonly displayName: string | undefined;
	readonly memberHrefs: ReadonlyArray<string> | undefined;
}

const NO_UPDATES: ProppatchUpdates = {
	displayName: undefined,
	memberHrefs: undefined,
};

/**
 * Reads the hrefs of a `DAV:group-member-set`. An absent element leaves
 * membership untouched (undefined); a present but childless one clears it.
 */
const extractMemberHrefs = (
	prop: Record<string, unknown>,
): ReadonlyArray<string> | undefined => {
	const memberSetEl = prop[`{${DAV_NS}}group-member-set`];
	if (memberSetEl === "") {
		return [];
	}
	if (!isXmlNode(memberSetEl)) {
		return undefined;
	}
	const href = memberSetEl[`{${DAV_NS}}href`];
	if (typeof href === "string") {
		return [href];
	}
	return Array.isArray(href)
		? href.filter((h): h is string => typeof h === "string")
		: [];
};

const extractUpdates = (tree: unknown): ProppatchUpdates => {
	const prop = xmlPath(
		tree,
		`{${DAV_NS}}propertyupdate`,
		`{${DAV_NS}}set`,
		`{${DAV_NS}}prop`,
	);
	if (prop === undefined) {
		return NO_UPDATES;
	}
	// The shuriken-namespaced name is accepted as a fallback for older clients
	return {
		displayName:
			xmlText(prop, `{${DAV_NS}}displayname`) ??
			xmlText(prop, `{${SHURIKEN_NS}}displayname`),
		memberHrefs: extractMemberHrefs(prop),
	};
};

// Malformed XML is treated as an empty body rather than a hard failure
const parseUpdates = (body: string): Effect.Effect<ProppatchUpdates> =>
	parseXml(body).pipe(
		Effect.map((parsed) => extractUpdates(normalizeClarkNames(parsed))),
		Effect.catchTag("XmlParseError", () => Effect.succeed(NO_UPDATES)),
	);

const parseBody = (req: Request): Effect.Effect<ProppatchUpdates, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) =>
			body.trim() === "" ? Effect.succeed(NO_UPDATES) : parseUpdates(body),
		),
	);

// ---------------------------------------------------------------------------
// Href → slug extraction
// ---------------------------------------------------------------------------

/** Extracts the user slug from a /dav/users/:slug/ href */
const slugFromUserHref = (href: string): Option.Option<string> =>
	Option.fromUndefinedOr(USER_HREF.exec(href)?.[1]);

/** Resolves member hrefs to user ids, silently dropping ones that name no user */
const resolveMemberIds = (
	hrefs: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<UserId>, DatabaseError, UserService> =>
	Effect.gen(function* () {
		const userSvc = yield* UserService;
		const userIds: Array<UserId> = [];
		for (const href of hrefs) {
			const slug = slugFromUserHref(href);
			if (Option.isNone(slug)) {
				continue;
			}
			const found = yield* userSvc.findBySlug(slug.value as Slug).pipe(
				Effect.map(Option.some),
				Effect.catchTag("DavError", () => Effect.succeed(Option.none())),
			);
			Option.map(found, (f) => userIds.push(f.user.id as UserId));
		}
		return userIds;
	});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Handles PROPPATCH /dav/groups/:slug — updates group properties and/or membership. */
export const groupProppatchHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	AclService | GroupService | UserService
> =>
	Effect.gen(function* () {
		if (path.kind !== "group") {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const requester = ctx.auth.principal;
		const acl = yield* AclService;

		yield* acl
			.check(
				requester.principalId,
				path.principalId,
				"principal",
				"DAV:write-properties",
			)
			.pipe(
				Effect.catchTag("DavError", () =>
					acl.check(
						requester.principalId,
						GROUPS_VIRTUAL_RESOURCE_ID,
						"virtual",
						"DAV:write-properties",
					),
				),
			);

		const { displayName, memberHrefs } = yield* parseBody(req);
		const groupSvc = yield* GroupService;

		if (displayName !== undefined) {
			yield* groupSvc.update(path.groupId, { displayName });
		}

		if (memberHrefs !== undefined) {
			const userIds = yield* resolveMemberIds(memberHrefs);
			yield* groupSvc.setMembers(path.groupId, userIds);
		}

		return new Response(null, { status: HTTP_NO_CONTENT });
	});
