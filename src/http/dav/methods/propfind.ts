// ---------------------------------------------------------------------------
// PROPFIND handler — RFC 4918 §9.1
//
// Supported path kinds:
//   collection      → collection properties + (Depth:1) instance members
//   collectionHome  → per-type home (e.g. /cal/) + (Depth:1) typed collections
//   instance        → instance properties only
//   principal       → minimal home-set properties
//   new-collection / new-instance → 404
//   principalCollection / wellknown → 404 (router handles well-known redirect before PROPFIND)
//
// Depth: infinity is rejected with 403 DAV:propfind-finite-depth (RFC 4918 §9.1).
// Missing Depth header is treated as "infinity" per RFC 4918 §9.1 → also 403.
// (Clients that want a single-level response must send Depth: 0 or Depth: 1.)
//
// The property builders live under ./propfind/; this file is dispatch only.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type {
	DatabaseError,
	DavError,
	XmlParseError,
} from "#src/domain/errors.ts";
import {
	badRequest,
	forbidden,
	notFound,
	unauthorized,
} from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import type { GroupService } from "#src/services/group/index.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import type { PrincipalRepository } from "#src/services/principal/index.ts";
import type { PrincipalService } from "#src/services/principal/service.ts";
import type { CalTimezoneRepository } from "#src/services/timezone/index.ts";
import { collectionResponses } from "./propfind/collection.ts";
import type { PropfindContext } from "./propfind/context.ts";
import { parsePropfindBody } from "./propfind/parse.ts";
import { principalResponses } from "./propfind/principal.ts";
import {
	collectionHomeResponses,
	groupResponses,
	instanceResponses,
	principalCollectionResponses,
	rootResponses,
} from "./propfind/simple.ts";

// The path kinds PROPFIND describes. Every other kind is 404: new resources do
// not exist yet, and user and group member paths have their own handlers.
type ServedKind =
	| "principal"
	| "collection"
	| "collectionHome"
	| "root"
	| "principalCollection"
	| "group"
	| "instance";

type ServedPath = Extract<ResolvedDavPath, { kind: ServedKind }>;

const SERVED_KINDS: ReadonlySet<string> = new Set<ServedKind>([
	"principal",
	"collection",
	"collectionHome",
	"root",
	"principalCollection",
	"group",
	"instance",
]);

const isServedPath = (path: ResolvedDavPath): path is ServedPath =>
	SERVED_KINDS.has(path.kind);

/**
 * RFC 4918 §9.1 says a missing Depth is equivalent to infinity, which this
 * server rejects with DAV:propfind-finite-depth. Historically every CalDAV
 * client and every other DAV server (Apple CalendarServer, DAViCal, Radicale,
 * Baikal, ...) treats a missing Depth as 0, so the convention is followed here.
 *
 * The spec allows only "0", "1" and "infinity"; per RFC 4918 §10.2 anything
 * else is rejected with 400 rather than silently coerced to 0, because silent
 * coercion masks client bugs.
 */
const parseDepth = (req: Request): Effect.Effect<0 | 1, DavError> => {
	const depthHeader = req.headers.get("Depth") ?? "0";
	if (depthHeader === "infinity") {
		return forbidden("DAV:propfind-finite-depth");
	}
	if (depthHeader === "0") {
		return Effect.succeed(0);
	}
	if (depthHeader === "1") {
		return Effect.succeed(1);
	}
	return badRequest(
		`Invalid Depth header "${depthHeader}" — must be 0, 1, or infinity`,
	);
};

/** Dispatches to the branch that knows how to describe this resource kind */
const responsesFor = Effect.fn("dav.propfind.dispatch")(function* (
	path: ServedPath,
	ctx: PropfindContext,
) {
	if (path.kind === "principal") {
		return yield* principalResponses(path, ctx);
	}
	if (path.kind === "collection") {
		return yield* collectionResponses(path, ctx);
	}
	if (path.kind === "collectionHome") {
		return yield* collectionHomeResponses(path, ctx);
	}
	if (path.kind === "root") {
		return rootResponses(ctx);
	}
	if (path.kind === "principalCollection") {
		return yield* principalCollectionResponses(ctx);
	}
	if (path.kind === "group") {
		return yield* groupResponses(path, ctx);
	}
	return yield* instanceResponses(path, ctx);
});

export const propfindHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError | XmlParseError,
	| CollectionService
	| InstanceService
	| AclService
	| PrincipalService
	| PrincipalRepository
	| CalTimezoneRepository
	| GroupService
	| ComponentRepository
	| ExternalCalendarRepository
> =>
	Effect.gen(function* () {
		const depth = yield* parseDepth(req);

		if (!isServedPath(path)) {
			return yield* notFound();
		}

		// Require authentication — all non-OPTIONS methods require credentials
		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const actingPrincipalId = ctx.auth.principal.principalId;
		const origin = ctx.url.origin;

		const responses = yield* responsesFor(path, {
			actingPrincipalId,
			actingPrincipalHref: `${origin}/dav/principals/${actingPrincipalId}/`,
			origin,
			request: yield* parsePropfindBody(req),
			depth,
		});

		return yield* multistatusResponse(responses);
	});
