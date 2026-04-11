import { Effect } from "effect";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import {
	SHURIKEN_NS,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { HTTP_CREATED } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// MKCOL body parsing
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";

interface UserMkcolProps {
	readonly displayName: string | undefined;
	readonly name: string | undefined;
	readonly email: string | undefined;
}

const EMPTY_PROPS: UserMkcolProps = {
	displayName: undefined,
	name: undefined,
	email: undefined,
};

const extractProps = (tree: unknown): UserMkcolProps => {
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
			: undefined;
	const name =
		typeof prop[`{${SHURIKEN_NS}}name`] === "string"
			? (prop[`{${SHURIKEN_NS}}name`] as string)
			: undefined;
	const email =
		typeof prop[`{${SHURIKEN_NS}}email`] === "string"
			? (prop[`{${SHURIKEN_NS}}email`] as string)
			: undefined;

	return { displayName, name, email };
};

const parseBody = (req: Request): Effect.Effect<UserMkcolProps, DavError> =>
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

/** Handles MKCOL /dav/users/:slug — creates a new user principal. */
export const userMkcolHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError | ConflictError | InternalError,
	AclService | UserService
> =>
	Effect.gen(function* () {
		if (path.kind !== "newUser") {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const requester = ctx.auth.principal;

		const acl = yield* AclService;
		yield* acl.check(
			requester.principalId,
			USERS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:bind",
		);

		const { displayName, email } = yield* parseBody(req);

		if (email === undefined) {
			// Email is required to create a user; fail with 400 Bad Request if missing.
			return new Response("Email is required", { status: 400 });
		}

		const userSvc = yield* UserService;
		yield* userSvc.create({
			slug: path.slug as Slug,
			email: Email(email),
			displayName,
		});

		const location = `${ctx.url.origin}/dav/users/${path.slug}/`;
		return new Response(null, {
			status: HTTP_CREATED,
			headers: { Location: location },
		});
	});
