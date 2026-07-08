import { Effect } from "effect";
import type { CollectionType } from "#src/db/drizzle/schema/index.ts";
import {
	badRequest,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, isUuid, type UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	type InvalidReorder,
	reorderCollections,
} from "#src/services/collection/reorder.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/collections/reorder
//
// Body (JSON): { collectionType, movedId, order: [collectionId, ...] }
//
// Reordering is inherently JS-driven (drag-and-drop), so this endpoint takes a
// JSON body rather than a form. `order` is the full desired top-to-bottom order
// of the authenticated principal's collections of `collectionType`; `movedId`
// is the single item the user dragged. Ownership is implicit — the use-case only
// ever considers the caller's own collections.
// ---------------------------------------------------------------------------

// Only calendars and address books are user-orderable in the UI; each is a
// separate ordered list.
const ORDERABLE_TYPES: ReadonlySet<CollectionType> = new Set<CollectionType>([
	"calendar",
	"addressbook",
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;

export const collectionsReorderHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	CollectionRepository | ExternalCalendarRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);

		const body = yield* Effect.tryPromise({
			try: () => req.json() as Promise<unknown>,
			catch: (e) => new InternalError({ cause: e }),
		});

		if (!isRecord(body)) {
			return yield* Effect.fail(badRequest("invalid reorder payload"));
		}

		const { collectionType, movedId, order } = body;
		if (
			typeof collectionType !== "string" ||
			!ORDERABLE_TYPES.has(collectionType as CollectionType)
		) {
			return yield* Effect.fail(badRequest("invalid collectionType"));
		}
		if (typeof movedId !== "string" || !isUuid(movedId)) {
			return yield* Effect.fail(badRequest("invalid movedId"));
		}
		if (!Array.isArray(order) || order.length === 0) {
			return yield* Effect.fail(badRequest("invalid order"));
		}
		const desiredIds: Array<UuidString> = [];
		for (const id of order) {
			if (typeof id !== "string" || !isUuid(id)) {
				return yield* Effect.fail(badRequest("invalid order"));
			}
			desiredIds.push(id);
		}

		yield* reorderCollections({
			ownerPrincipalId: principal.principalId,
			collectionType: collectionType as CollectionType,
			desiredIds: desiredIds.map((id) => CollectionId(id)),
			movedId: CollectionId(movedId),
		}).pipe(
			Effect.catchTag("InvalidReorder", (e: InvalidReorder) =>
				Effect.fail(badRequest(e.message)),
			),
		);

		return new Response(null, { status: HTTP_NO_CONTENT });
	});
