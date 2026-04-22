import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { InternalError as InternalErr } from "#src/domain/errors.ts";
import type { PrincipalId, UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	buildAclPanelData,
	COMMON_PRIVILEGE_OPTIONS,
} from "#src/http/ui/helpers/acl-panel.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { renderFragment } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclResourceType, NewAce } from "#src/services/acl/index.ts";
import { type AclResourceId, AclService } from "#src/services/acl/service.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";
import { PrincipalRepository } from "#src/services/principal/repository.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/acl/:resourceType/:resourceId/grant
// ---------------------------------------------------------------------------

const VALID_PRIVILEGES = new Set<string>(
	COMMON_PRIVILEGE_OPTIONS.map((o) => o.value),
);

export const aclGrantHandler = (
	req: Request,
	ctx: HttpRequestContext,
	resourceType: AclResourceType,
	resourceId: AclResourceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | PrincipalRepository | PrincipalService | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const principalRepo = yield* PrincipalRepository;

		yield* acl.check(
			principal.principalId,
			resourceId,
			resourceType,
			"DAV:write-acl",
		);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalErr({ cause: e }),
		});

		const principalSlug = form.get("principalSlug")?.toString()?.trim() ?? "";
		const privilege = form.get("privilege")?.toString() ?? "";

		if (!principalSlug || !VALID_PRIVILEGES.has(privilege)) {
			return new Response("Missing or invalid fields", { status: 400 });
		}

		const maybePrincipal = yield* principalRepo.findPrincipalBySlug(
			Slug(principalSlug),
		);
		if (Option.isNone(maybePrincipal)) {
			return new Response("Principal not found", { status: 400 });
		}
		const targetPrincipalId = maybePrincipal.value.id as PrincipalId;

		const existingAces = yield* acl.getAces(resourceId, resourceType);
		const nonProtected = existingAces.filter((a) => !a.protected);
		const maxOrdinal = nonProtected.reduce(
			(max, a) => Math.max(max, a.ordinal),
			-10,
		);

		const nextAces: ReadonlyArray<NewAce> = [
			...nonProtected.map(
				(a): NewAce => ({
					resourceType: a.resourceType,
					resourceId: a.resourceId as UuidString,
					principalType: a.principalType,
					principalId: a.principalId as UuidString | undefined,
					privilege: a.privilege as DavPrivilege,
					grantDeny: a.grantDeny,
					protected: a.protected,
					ordinal: a.ordinal,
				}),
			),
			{
				resourceType,
				resourceId: resourceId as UuidString,
				principalType: "principal",
				principalId: targetPrincipalId as UuidString,
				privilege: privilege as DavPrivilege,
				grantDeny: "grant",
				protected: false,
				ordinal: maxOrdinal + 10,
			},
		];

		yield* acl.setAces(resourceId, resourceType, nextAces);

		const panelData = yield* buildAclPanelData(
			principal.principalId,
			resourceId,
			resourceType,
		);
		return yield* renderFragment("partials/acl-panel", {
			aclPanel: Option.getOrUndefined(panelData),
		});
	});
