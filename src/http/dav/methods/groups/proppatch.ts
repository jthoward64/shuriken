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
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";

interface ProppatchUpdates {
	readonly displayName: string | undefined;
	readonly memberHrefs: ReadonlyArray<string> | undefined;
}

const extractUpdates = (tree: unknown): ProppatchUpdates => {
	const empty: ProppatchUpdates = {
		displayName: undefined,
		memberHrefs: undefined,
	};
	if (typeof tree !== "object" || tree === null) {
		return empty;
	}
	const root = tree as Record<string, unknown>;
	const update = root[`{${DAV_NS}}propertyupdate`] as
		| Record<string, unknown>
		| undefined;
	if (typeof update !== "object" || update === null) {
		return empty;
	}
	const set = update[`{${DAV_NS}}set`] as Record<string, unknown> | undefined;
	if (typeof set !== "object" || set === null) {
		return empty;
	}
	const prop = set[`{${DAV_NS}}prop`] as Record<string, unknown> | undefined;
	if (typeof prop !== "object" || prop === null) {
		return empty;
	}

	const displayName =
		typeof prop[`{${DAV_NS}}displayname`] === "string"
			? (prop[`{${DAV_NS}}displayname`] as string)
			: typeof prop[`{${SHURIKEN_NS}}displayname`] === "string"
				? (prop[`{${SHURIKEN_NS}}displayname`] as string)
				: undefined;

	// DAV:group-member-set contains one or more DAV:href children
	let memberHrefs: ReadonlyArray<string> | undefined;
	const memberSetEl = prop[`{${DAV_NS}}group-member-set`];
	if (typeof memberSetEl === "object" && memberSetEl !== null) {
		const ms = memberSetEl as Record<string, unknown>;
		const href = ms[`{${DAV_NS}}href`];
		if (typeof href === "string") {
			memberHrefs = [href];
		} else if (Array.isArray(href)) {
			memberHrefs = href.filter((h): h is string => typeof h === "string");
		} else {
			// group-member-set present but empty
			memberHrefs = [];
		}
	} else if (memberSetEl === "") {
		// Explicit empty string means clear all members
		memberHrefs = [];
	}

	return { displayName, memberHrefs };
};

const parseBody = (req: Request): Effect.Effect<ProppatchUpdates, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) => {
			if (body.trim() === "") {
				return Effect.succeed({
					displayName: undefined,
					memberHrefs: undefined,
				} satisfies ProppatchUpdates);
			}
			return parseXml(body).pipe(
				Effect.map((parsed) => extractUpdates(normalizeClarkNames(parsed))),
				Effect.catchTag("XmlParseError", () =>
					Effect.succeed({
						displayName: undefined,
						memberHrefs: undefined,
					} satisfies ProppatchUpdates),
				),
			);
		}),
	);

// ---------------------------------------------------------------------------
// Href → slug extraction
// ---------------------------------------------------------------------------

/** Extracts the user slug from a /dav/users/:slug/ href, returning null if unrecognised. */
const slugFromUserHref = (href: string): string | null => {
	const match = /\/dav\/users\/([^/]+)\/?$/.exec(href);
	return match?.[1] ?? null;
};

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
			const userSvc = yield* UserService;
			const userIds: Array<UserId> = [];
			for (const href of memberHrefs) {
				const slug = slugFromUserHref(href);
				if (slug !== null) {
					const found = yield* userSvc.findBySlug(slug as Slug).pipe(
						Effect.map(Option.some),
						Effect.catchTag("DavError", () => Effect.succeed(Option.none())),
					);
					if (Option.isSome(found)) {
						userIds.push(found.value.user.id as UserId);
					}
				}
			}
			yield* groupSvc.setMembers(path.groupId, userIds);
		}

		return new Response(null, { status: HTTP_NO_CONTENT });
	});
