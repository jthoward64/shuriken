import { Effect, Redacted } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { methodNotAllowed, unauthorized } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import {
	SHURIKEN_NS,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { xmlChild, xmlPath, xmlText } from "#src/http/dav/methods/xml-node.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { UserService } from "#src/services/user/index.ts";
import type { NewCredential } from "#src/services/user/service.ts";

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";

interface ProppatchUpdates {
	readonly displayName: string | undefined;
	readonly email: string | undefined;
	readonly credential: NewCredential | undefined;
}

const NO_UPDATES: ProppatchUpdates = {
	displayName: undefined,
	email: undefined,
	credential: undefined,
};

/** Reads a `{shuriken}credential` element into a `NewCredential`, if it is complete */
const extractCredential = (
	prop: Record<string, unknown>,
): NewCredential | undefined => {
	const credEl = xmlChild(prop, `{${SHURIKEN_NS}}credential`);
	if (credEl === undefined) {
		return undefined;
	}
	const source = credEl[`{${SHURIKEN_NS}}source`];
	const authId = xmlText(credEl, `{${SHURIKEN_NS}}auth-id`);
	const password = xmlText(credEl, `{${SHURIKEN_NS}}password`);
	if (authId === undefined) {
		return undefined;
	}
	if (source === "local" && password !== undefined) {
		return { source: "local", authId, password: Redacted.make(password) };
	}
	return source === "proxy" ? { source: "proxy", authId } : undefined;
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
	return {
		displayName: xmlText(prop, `{${DAV_NS}}displayname`),
		email: xmlText(prop, `{${SHURIKEN_NS}}email`),
		credential: extractCredential(prop),
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
// Handler
// ---------------------------------------------------------------------------

/** Handles PROPPATCH /dav/users/:slug — updates user properties. */
export const userProppatchHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | UserService
> =>
	Effect.gen(function* () {
		if (path.kind !== "user") {
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
						USERS_VIRTUAL_RESOURCE_ID,
						"virtual",
						"DAV:write-properties",
					),
				),
			);

		const { displayName, email, credential } = yield* parseBody(req);
		const userSvc = yield* UserService;

		if (displayName !== undefined || email !== undefined) {
			yield* userSvc.update(path.userId, {
				displayName,
				email: email as Email | undefined,
			});
		}

		if (credential !== undefined) {
			yield* userSvc.setCredential(path.userId, credential);
		}

		return new Response(null, { status: HTTP_NO_CONTENT });
	});
