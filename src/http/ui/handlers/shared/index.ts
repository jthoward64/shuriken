import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, type PrincipalId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import type { AclService } from "#src/services/acl/service.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { PrincipalRepository } from "#src/services/principal/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/shared — surfaces resources another principal has explicitly
// granted to the current user (or one of their groups). The user already
// implicitly has access via DAV:read, but without a discovery page they'd
// only find shared resources if they knew the URL.
// ---------------------------------------------------------------------------

// Any of these privileges on a resource qualifies it as "shared".
// DAV:read is the common case; DAV:all and DAV:write imply read.
const READ_PRIVILEGES: ReadonlyArray<string> = [
	"DAV:read",
	"DAV:all",
	"DAV:write",
];

export const sharedWithMeHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclRepository
	| AclService
	| AppConfigService
	| CollectionRepository
	| InstanceRepository
	| PrincipalRepository
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const aclRepo = yield* AclRepository;
		const collRepo = yield* CollectionRepository;
		const instRepo = yield* InstanceRepository;
		const principalRepo = yield* PrincipalRepository;

		const groupIds = yield* aclRepo.getGroupPrincipalIds(principal.principalId);
		const principalSet: ReadonlyArray<PrincipalId> = [
			principal.principalId,
			...groupIds,
		];

		const [collections, instances] = yield* Effect.all(
			[
				collRepo.listSharedWithPrincipals(principalSet, READ_PRIVILEGES),
				instRepo.listSharedWithPrincipals(principalSet, READ_PRIVILEGES),
			],
			{ concurrency: "unbounded" },
		);

		// Resolve each shared resource's owner so the UI can show "from <slug>".
		const uniqueOwners = new Set<string>();
		for (const c of collections) {
			uniqueOwners.add(c.ownerPrincipalId);
		}
		for (const i of instances) {
			const c = collections.find((cc) => cc.id === i.collectionId);
			if (c) {
				uniqueOwners.add(c.ownerPrincipalId);
			}
		}
		const owners = yield* principalRepo.findPrincipalByIds(
			[...uniqueOwners].map((id) => id as PrincipalId),
		);
		const ownerLabels = new Map<string, string>();
		for (const ownerId of uniqueOwners) {
			const row = owners.get(ownerId as PrincipalId);
			ownerLabels.set(ownerId, row?.slug ?? ownerId);
		}

		const sharedCollections = collections.map((c) => ({
			id: c.id,
			displayName: c.displayName ?? c.slug,
			collectionType: c.collectionType,
			ownerSlug: ownerLabels.get(c.ownerPrincipalId) ?? c.ownerPrincipalId,
		}));

		// For instances, also fetch the parent collection so we can display
		// "<event-uid> from <owner>'s <calendar-name>".
		const instanceCollIds = [...new Set(instances.map((i) => i.collectionId))];
		const instanceColls = yield* collRepo.findByIds(
			instanceCollIds.map((cid) => CollectionId(cid)),
		);
		const instanceCollMap = new Map<string, string>();
		for (const cid of instanceCollIds) {
			const coll = instanceColls.get(CollectionId(cid));
			if (coll !== undefined) {
				instanceCollMap.set(cid, coll.displayName ?? coll.slug);
			}
		}
		const sharedInstances = instances.map((i) => {
			const collDisplay = instanceCollMap.get(i.collectionId) ?? i.collectionId;
			return {
				id: i.id,
				slug: i.slug,
				collectionId: i.collectionId,
				collectionDisplay: collDisplay,
			};
		});

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			"pages/shared/index",
			{
				...nav,
				pageTitle: "Shared with me",
				sharedCollections,
				sharedInstances,
			},
			ctx.headers,
		);
	});
