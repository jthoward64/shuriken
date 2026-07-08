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

const extractUpdates = (tree: unknown): ProppatchUpdates => {
	const empty: ProppatchUpdates = {
		displayName: undefined,
		email: undefined,
		credential: undefined,
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
			: undefined;
	const email =
		typeof prop[`{${SHURIKEN_NS}}email`] === "string"
			? (prop[`{${SHURIKEN_NS}}email`] as string)
			: undefined;

	let credential: NewCredential | undefined;
	const credEl = prop[`{${SHURIKEN_NS}}credential`];
	if (typeof credEl === "object" && credEl !== null) {
		const c = credEl as Record<string, unknown>;
		const source = c[`{${SHURIKEN_NS}}source`];
		const authId = c[`{${SHURIKEN_NS}}auth-id`];
		const password = c[`{${SHURIKEN_NS}}password`];
		if (
			source === "local" &&
			typeof authId === "string" &&
			typeof password === "string"
		) {
			credential = {
				source: "local",
				authId,
				password: Redacted.make(password),
			};
		} else if (source === "proxy" && typeof authId === "string") {
			credential = { source: "proxy", authId };
		}
	}

	return { displayName, email, credential };
};

const parseBody = (req: Request): Effect.Effect<ProppatchUpdates, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) => {
			if (body.trim() === "") {
				return Effect.succeed({
					displayName: undefined,
					email: undefined,
					credential: undefined,
				} satisfies ProppatchUpdates);
			}
			return parseXml(body).pipe(
				Effect.map((parsed) => extractUpdates(normalizeClarkNames(parsed))),
				Effect.catchTag("XmlParseError", () =>
					Effect.succeed({
						displayName: undefined,
						email: undefined,
						credential: undefined,
					} satisfies ProppatchUpdates),
				),
			);
		}),
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
