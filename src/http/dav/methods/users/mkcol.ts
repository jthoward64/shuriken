import { Effect } from "effect";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import { parseEmail } from "#src/domain/types/strings.ts";
import {
	SHURIKEN_NS,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { xmlPath, xmlText } from "#src/http/dav/methods/xml-node.ts";
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
	readonly email: string | undefined;
}

const EMPTY_PROPS: UserMkcolProps = {
	displayName: undefined,
	email: undefined,
};

const extractProps = (tree: unknown): UserMkcolProps => {
	const prop = xmlPath(
		tree,
		`{${DAV_NS}}mkcol`,
		`{${DAV_NS}}set`,
		`{${DAV_NS}}prop`,
	);
	if (prop === undefined) {
		return EMPTY_PROPS;
	}
	return {
		displayName: xmlText(prop, `{${DAV_NS}}displayname`),
		email: xmlText(prop, `{${SHURIKEN_NS}}email`),
	};
};

// Malformed XML is treated as an empty body rather than a hard failure
const parseProps = (body: string): Effect.Effect<UserMkcolProps> =>
	parseXml(body).pipe(
		Effect.map((parsed) => extractProps(normalizeClarkNames(parsed))),
		Effect.catchTag("XmlParseError", () => Effect.succeed(EMPTY_PROPS)),
	);

const parseBody = (req: Request): Effect.Effect<UserMkcolProps, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) =>
			body.trim() === "" ? Effect.succeed(EMPTY_PROPS) : parseProps(body),
		),
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
			email: parseEmail(email),
			displayName,
		});

		const location = `${ctx.url.origin}/dav/users/${path.slug}/`;
		return new Response(null, {
			status: HTTP_CREATED,
			headers: { Location: location },
		});
	});
