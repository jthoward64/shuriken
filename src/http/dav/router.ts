import { Effect } from "effect";
import { notFound } from "#/domain/errors.ts";
import type { AppError, DavError } from "#/domain/errors.ts";
import { HTTP_METHOD_NOT_ALLOWED } from "#/http/status.ts";
import { CollectionId, InstanceId, PrincipalId } from "#/domain/ids.ts";
import { CollectionRepository } from "#/services/collection/index.ts";
import { InstanceRepository } from "#/services/instance/index.ts";
import { PrincipalRepository } from "#/services/principal/index.ts";
import { Slug } from "#/domain/types/path.ts";
import type { ResolvedDavPath } from "#/domain/types/path.ts";
import type { HttpRequestContext } from "#/http/context.ts";
import { deleteHandler } from "./methods/delete.ts";
import { getHandler } from "./methods/get.ts";
import { mkcolHandler } from "./methods/mkcol.ts";
import { optionsHandler } from "./methods/options.ts";
import { propfindHandler } from "./methods/propfind.ts";
import { proppatchHandler } from "./methods/proppatch.ts";
import { putHandler } from "./methods/put.ts";
import { reportHandler } from "./methods/report.ts";

// ---------------------------------------------------------------------------
// DAV router — slug resolution + method dispatch
//
// URL patterns handled:
//   /.well-known/caldav              → wellknown
//   /.well-known/carddav             → wellknown
//   /principals/:slug                → principal
//   /principals/:slug/:collSlug      → collection
//   /principals/:slug/:collSlug/:obj → instance
// ---------------------------------------------------------------------------

type DavServices =
	| PrincipalRepository
	| CollectionRepository
	| InstanceRepository;

/** Parse and resolve a DAV URL path, converting slugs to branded UUIDs. */
// Path segment counts for the /principals/:slug/... hierarchy
const SEGMENTS_PRINCIPAL = 2;
const SEGMENTS_COLLECTION = 3;

const parseDavPath = (
	url: URL,
): Effect.Effect<
	ResolvedDavPath,
	DavError | import("#/domain/errors.ts").DatabaseError,
	DavServices
> => {
	const path = url.pathname.replace(/\/$/, ""); // strip trailing slash

	if (path === "/.well-known/caldav") {
		return Effect.succeed({ kind: "wellknown", name: "caldav" });
	}
	if (path === "/.well-known/carddav") {
		return Effect.succeed({ kind: "wellknown", name: "carddav" });
	}

	const segments = path.split("/").filter(Boolean);

	if (segments[0] !== "principals" || segments.length < 2) {
		return Effect.fail(notFound(`Unknown DAV path: ${path}`));
	}

	const principalSlug = Slug(decodeURIComponent(segments[1] ?? ""));

	return Effect.gen(function* () {
		const principalRepo = yield* PrincipalRepository;
		const principalRow = yield* principalRepo.findBySlug(principalSlug);
		if (!principalRow) {
			return yield* Effect.fail(
				notFound(`Principal not found: ${principalSlug}`),
			);
		}
		const principalId = PrincipalId(principalRow.principal.id);

		if (segments.length === SEGMENTS_PRINCIPAL) {
			return { kind: "principal", principalId } satisfies ResolvedDavPath;
		}

		const collSlug = Slug(decodeURIComponent(segments[2] ?? ""));
		const collRepo = yield* CollectionRepository;
		const collRow = yield* collRepo.findBySlug(principalId, collSlug);
		if (!collRow) {
			return yield* Effect.fail(notFound(`Collection not found: ${collSlug}`));
		}
		const collectionId = CollectionId(collRow.id);

		if (segments.length === SEGMENTS_COLLECTION) {
			return {
				kind: "collection",
				principalId,
				collectionId,
			} satisfies ResolvedDavPath;
		}

		const objSlug = Slug(decodeURIComponent(segments[3] ?? ""));
		const instRepo = yield* InstanceRepository;
		const instRow = yield* instRepo.findBySlug(collectionId, objSlug);
		if (!instRow) {
			return yield* Effect.fail(notFound(`Instance not found: ${objSlug}`));
		}
		const instanceId = InstanceId(instRow.id);

		return {
			kind: "instance",
			principalId,
			collectionId,
			instanceId,
		} satisfies ResolvedDavPath;
	});
};

/** Dispatch a DAV request to the appropriate method handler. */
export const davRouter = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<Response, AppError, DavServices> =>
	Effect.gen(function* () {
		const path = yield* parseDavPath(ctx.url);

		switch (req.method.toUpperCase()) {
			case "OPTIONS":
				return yield* optionsHandler(path, ctx);
			case "PROPFIND":
				return yield* propfindHandler(path, ctx, req);
			case "PROPPATCH":
				return yield* proppatchHandler(path, ctx, req);
			case "REPORT":
				return yield* reportHandler(path, ctx, req);
			case "GET":
			case "HEAD":
				return yield* getHandler(path, ctx);
			case "PUT":
				return yield* putHandler(path, ctx, req);
			case "DELETE":
				return yield* deleteHandler(path, ctx);
			case "MKCOL":
			case "MKCALENDAR":
			case "MKADDRESSBOOK":
				return yield* mkcolHandler(path, ctx, req);
			default:
				return new Response(null, {
					status: HTTP_METHOD_NOT_ALLOWED,
					headers: {
						// biome-ignore lint/style/useNamingConvention: HTTP header name
						Allow:
							"OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, REPORT",
					},
				});
		}
	}).pipe(
		Effect.catchTag("DavError", (err) =>
			Effect.succeed(new Response(null, { status: err.status })),
		),
	);
