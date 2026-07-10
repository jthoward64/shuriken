import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { buildSharePanelData } from "#src/http/ui/helpers/share-panel.ts";
import { InstanceAclPage } from "#src/http/ui/view/pages/instances.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/service.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/instances/:id/acl — single-instance ACL editor. Mirrors the panel
// already exposed on collection-edit; lets a user share or unshare an event
// without giving access to the whole calendar. Useful when iMIP doesn't
// exist yet to drive per-event invites.
// ---------------------------------------------------------------------------

export const instanceAclHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | InstanceService | PrincipalService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const instanceSvc = yield* InstanceService;

		// Existence + read access are enforced together: getAces below would
		// quietly return an empty set for a non-existent UUID, which would
		// confuse the UI. findById raises 404 here for missing instances.
		const instance = yield* instanceSvc.findById(instanceId);
		yield* acl.check(principal.principalId, instanceId, "instance", "DAV:read");

		const panel = yield* buildSharePanelData(
			principal.principalId,
			instanceId,
			"instance",
		).pipe(Effect.map(Option.getOrUndefined));

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			<InstanceAclPage
				title={`Access — ${instance.slug}`}
				slug={instance.slug}
				collectionId={instance.collectionId}
				sharePanel={panel}
			/>,
			{ headers: ctx.headers, title: `Access — ${instance.slug}`, nav },
		);
	});
