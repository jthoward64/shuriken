import { Effect, Option, Result } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { InternalError as InternalErr } from "#src/domain/errors.ts";
import { isUuid, PrincipalId, type UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	buildSharePanelData,
	resolveIsCalendar,
} from "#src/http/ui/helpers/share-panel.ts";
import { tiersFor } from "#src/http/ui/helpers/share-tiers.ts";
import { SharePanel } from "#src/http/ui/view/pages/share-panel.tsx";
import { renderFragment } from "#src/http/ui/view/shell/render.tsx";
import type { NewAce, ResourceType } from "#src/services/acl/index.ts";
import { type AclResourceId, AclService } from "#src/services/acl/service.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";
import { PrincipalRepository } from "#src/services/principal/repository.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/acl/:resourceType/:resourceId/set-tier — Basic mode's atomic
// "give this person tier X" action: resolves the target principal (by slug
// from the "share with someone" form, or by principalId when re-tiering an
// existing grantee), drops their existing non-protected ACE rows on this
// resource, and inserts exactly the tier's canonical privilege rows. One
// setAces call — no window where the principal holds a partial/stale set.
// ---------------------------------------------------------------------------

// The principal a tier grant targets: the posted id when it names one, else the
// posted slug. A failure carries the 400 message for the caller to render.
const resolveTargetPrincipal = Effect.fn("ui.acl.setTier.target")(function* (
	principalSlug: string,
	targetPrincipalIdRaw: string,
) {
	const principalRepo = yield* PrincipalRepository;
	if (targetPrincipalIdRaw) {
		if (!isUuid(targetPrincipalIdRaw)) {
			return Result.fail("Invalid principalId");
		}
		const byId = yield* principalRepo.findPrincipalById(
			PrincipalId(targetPrincipalIdRaw),
		);
		return Option.match(byId, {
			onNone: () => Result.fail("Principal not found"),
			onSome: (found) => Result.succeed(PrincipalId(found.id)),
		});
	}
	const bySlug = yield* principalRepo.findPrincipalBySlug(Slug(principalSlug));
	return Option.match(bySlug, {
		onNone: () => Result.fail("Principal not found"),
		onSome: (found) => Result.succeed(PrincipalId(found.id)),
	});
});

export const aclSetTierHandler = (
	req: Request,
	ctx: HttpRequestContext,
	resourceType: ResourceType,
	resourceId: AclResourceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | PrincipalRepository | PrincipalService | CollectionService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;

		yield* acl.check(
			principal.principalId,
			resourceId,
			resourceType,
			"DAV:write-acl",
		);

		const isCalendar = yield* resolveIsCalendar(resourceType, resourceId);
		const validTiers = new Set<string>(
			tiersFor(resourceType, isCalendar).map((t) => t.tier),
		);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalErr({ cause: e }),
		});

		const tier = form.get("tier")?.toString() ?? "";
		const principalSlug = form.get("principalSlug")?.toString()?.trim() ?? "";
		const targetPrincipalIdRaw =
			form.get("principalId")?.toString()?.trim() ?? "";

		if (!validTiers.has(tier)) {
			return new Response("Invalid tier for this resource type", {
				status: 400,
			});
		}
		if (!(principalSlug || targetPrincipalIdRaw)) {
			return new Response("Missing principalSlug or principalId", {
				status: 400,
			});
		}

		const target = yield* resolveTargetPrincipal(
			principalSlug,
			targetPrincipalIdRaw,
		);
		if (Result.isFailure(target)) {
			return new Response(target.failure, { status: 400 });
		}
		const targetPrincipalId = target.success;

		const tierPrivileges =
			tiersFor(resourceType, isCalendar).find((t) => t.tier === tier)
				?.privileges ?? [];

		const existingAces = yield* acl.getAces(resourceId, resourceType);
		const otherAces = existingAces.filter(
			(a) => a.protected || a.principalId !== targetPrincipalId,
		);
		const maxOrdinal = otherAces
			.filter((a) => !a.protected)
			.reduce((max, a) => Math.max(max, a.ordinal), -10);

		const nextAces: ReadonlyArray<NewAce> = [
			...otherAces.map(
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
			...tierPrivileges.map(
				(privilege, i): NewAce => ({
					resourceType,
					resourceId: resourceId as UuidString,
					principalType: "principal",
					principalId: targetPrincipalId as UuidString,
					privilege,
					grantDeny: "grant",
					protected: false,
					ordinal: maxOrdinal + 10 + i,
				}),
			),
		];

		yield* acl.setAces(resourceId, resourceType, nextAces);

		const panelData = yield* buildSharePanelData(
			principal.principalId,
			resourceId,
			resourceType,
			isCalendar,
		);
		return yield* renderFragment(
			<SharePanel data={Option.getOrUndefined(panelData)} />,
		);
	});
