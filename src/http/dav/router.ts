import { Effect, Option } from "effect";
import type { AppError, DavError } from "#src/domain/errors.ts";
import { notFound, someOrNotFound } from "#src/domain/errors.ts";
import { CollectionId, InstanceId, PrincipalId, isUuid } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import { Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_METHOD_NOT_ALLOWED } from "#src/http/status.ts";
import { CollectionRepository } from "#src/services/collection/index.ts";
import { InstanceRepository } from "#src/services/instance/index.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";
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
//   /.well-known/caldav                   → wellknown
//   /.well-known/carddav                  → wellknown
//   /dav/principals/:slug                 → principal
//   /dav/principals/:slug/:collSlug       → collection
//   /dav/principals/:slug/:collSlug/:obj  → instance
// ---------------------------------------------------------------------------

type DavServices =
	| PrincipalRepository
	| CollectionRepository
	| InstanceRepository;

// Path segment counts for the /dav/principals/:slug/... hierarchy (excluding "principals")
const SEGMENTS_PRINCIPAL = 2;
const SEGMENTS_COLLECTION = 3;

/** Parse and resolve a DAV URL path, converting slugs/UUIDs to branded UUIDs.
 *
 * Each path segment is detected as either a UUID or a slug:
 * - UUID segments are resolved via `findById` and ownership is verified against
 *   the parent (collection must belong to the resolved principal; instance must
 *   belong to the resolved collection).
 * - Slug segments are resolved via `findBySlug` as before.
 * - Missing resources still yield `new-collection` / `new-instance` regardless
 *   of whether the segment looked like a UUID, so PUT/MKCOL to a UUID-style URL
 *   is handled correctly.
 */
export const parseDavPath = (
	url: URL,
): Effect.Effect<
	ResolvedDavPath,
	DavError | import("#src/domain/errors.ts").DatabaseError,
	DavServices
> => {
	const path = url.pathname.replace(/\/$/, ""); // strip trailing slash

	if (path === "/.well-known/caldav") {
		return Effect.succeed({ kind: "wellknown", name: "caldav" });
	}
	if (path === "/.well-known/carddav") {
		return Effect.succeed({ kind: "wellknown", name: "carddav" });
	}

	// Strip /dav base prefix before parsing segments
	const davPrefix = "/dav";
	const davRelative = path.startsWith(davPrefix)
		? path.slice(davPrefix.length)
		: path;
	const segments = davRelative.split("/").filter(Boolean);

	// /dav/ or /dav — root DAV collection
	if (segments.length === 0) {
		return Effect.succeed({ kind: "root" } satisfies ResolvedDavPath);
	}

	if (segments[0] !== "principals") {
		return Effect.fail(notFound(`Unknown DAV path: ${path}`));
	}

	// /dav/principals/ — principal-collection listing
	if (segments.length === 1) {
		return Effect.succeed({
			kind: "principalCollection",
		} satisfies ResolvedDavPath);
	}

	const seg1 = decodeURIComponent(segments[1] ?? "");

	return Effect.gen(function* () {
		const principalRepo = yield* PrincipalRepository;
		const principalRow = yield* (
			isUuid(seg1)
				? principalRepo.findById(PrincipalId(seg1))
				: principalRepo.findBySlug(Slug(seg1))
		).pipe(Effect.flatMap(someOrNotFound(`Principal not found: ${seg1}`)));
		const principalId = PrincipalId(principalRow.principal.id);

		if (segments.length === SEGMENTS_PRINCIPAL) {
			return { kind: "principal", principalId } satisfies ResolvedDavPath;
		}

		const seg2 = decodeURIComponent(segments[2] ?? "");
		const collRepo = yield* CollectionRepository;
		const collRowOpt = yield* (
			isUuid(seg2)
				? collRepo.findById(CollectionId(seg2)).pipe(
						Effect.flatMap(
							Option.match({
								onNone: () => Effect.succeed(Option.none()),
								onSome: (row) =>
									row.ownerPrincipalId === principalId
										? Effect.succeed(Option.some(row))
										: Effect.fail(notFound(`Collection not found: ${seg2}`)),
							}),
						),
					)
				: collRepo.findBySlug(principalId, Slug(seg2))
		);
		if (Option.isNone(collRowOpt)) {
			return {
				kind: "new-collection",
				principalId,
				slug: Slug(seg2),
			} satisfies ResolvedDavPath;
		}
		const collectionId = CollectionId(collRowOpt.value.id);

		if (segments.length === SEGMENTS_COLLECTION) {
			return {
				kind: "collection",
				principalId,
				collectionId,
			} satisfies ResolvedDavPath;
		}

		const seg3 = decodeURIComponent(segments[3] ?? "");
		const instRepo = yield* InstanceRepository;
		const instRowOpt = yield* (
			isUuid(seg3)
				? instRepo.findById(InstanceId(seg3)).pipe(
						Effect.flatMap(
							Option.match({
								onNone: () => Effect.succeed(Option.none()),
								onSome: (row) =>
									row.collectionId === collectionId
										? Effect.succeed(Option.some(row))
										: Effect.fail(notFound(`Instance not found: ${seg3}`)),
							}),
						),
					)
				: instRepo.findBySlug(collectionId, Slug(seg3))
		);
		if (Option.isNone(instRowOpt)) {
			return {
				kind: "new-instance",
				principalId,
				collectionId,
				slug: Slug(seg3),
			} satisfies ResolvedDavPath;
		}

		return {
			kind: "instance",
			principalId,
			collectionId,
			instanceId: InstanceId(instRowOpt.value.id),
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

		// RFC 6764 §5: /.well-known/caldav and /.well-known/carddav must redirect
		// to the DAV context path so clients can perform service discovery.
		if (path.kind === "wellknown") {
			return new Response(null, {
				status: 301,
				// biome-ignore lint/style/useNamingConvention: HTTP header name
				headers: { Location: "/dav/" },
			});
		}

		// /dav/ and /dav/principals/ are valid paths — fall through to method dispatch
		// (handlers return 501 until implemented in Step 4)

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
