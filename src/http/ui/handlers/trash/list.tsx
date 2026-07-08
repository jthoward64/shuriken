import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { TrashPage } from "#src/http/ui/view/pages/trash.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { TrashService } from "#src/services/trash/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/trash — list the current user's soft-deleted collections and
// instances. Trash is a personal-ownership feature: each user only ever sees
// their own trash (no admin view of another principal's deleted items).
// ---------------------------------------------------------------------------

export const trashListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | CollectionService | TrashService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const trashSvc = yield* TrashService;
		const collectionSvc = yield* CollectionService;

		const [listing, activeCollections] = yield* Effect.all([
			trashSvc.listTrash(principal.principalId),
			collectionSvc.listByOwner(principal.principalId),
		]);

		// Name lookup for the instances table's "From" column: an instance's
		// parent collection may still be active (only the instance itself was
		// trashed) or may itself be in the deleted-collections list.
		const collectionNames = new Map<string, string>();
		for (const c of [...listing.collections, ...activeCollections]) {
			collectionNames.set(c.id, c.displayName ?? c.slug);
		}

		const collections = listing.collections.map((c) => ({
			id: c.id,
			displayName: c.displayName ?? c.slug,
			collectionType: c.collectionType,
			deletedAt: c.deletedAt?.toString() ?? "",
		}));

		const instances = listing.instances.map((i) => ({
			id: i.id,
			slug: i.slug,
			collectionName: collectionNames.get(i.collectionId) ?? "(unknown)",
			deletedAt: i.deletedAt?.toString() ?? "",
		}));

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			<TrashPage collections={collections} instances={instances} />,
			{
				headers: ctx.headers,
				title: "Trash",
				nav,
			},
		);
	});
