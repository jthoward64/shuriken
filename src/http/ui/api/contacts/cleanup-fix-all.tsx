import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { InternalError } from "#src/domain/errors.ts";
import type { InstanceId } from "#src/domain/ids.ts";
import { CollectionId, isUuid } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_SEE_OTHER } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import {
	DEFAULT_REGION,
	REGION_OPTIONS,
} from "#src/http/ui/helpers/regions.ts";
import { BulkJobProgress } from "#src/http/ui/view/pages/contacts/list.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/service.ts";
import {
	type BulkJobRepository,
	runChunkedJob,
} from "#src/services/bulk-job/index.ts";
import {
	ContactCleanupService,
	type ContactCleanupServiceShape,
} from "#src/services/contact-cleanup/service.ts";
import type { CleanupFix } from "#src/services/contact-cleanup/types.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/cleanup/fix-all
//
// Re-scans the selected addressbook and applies every auto-fixable suggestion
// (those with no `needsInput` — duplicates, name-case, lowercase-email).
// Suggestions that need extra input (area code, label choice) are left for the
// per-suggestion Fix button.
//
// `applyFix` does an unguarded read-modify-write per contact, so fixes for the
// same contact must never run concurrently; they're grouped by instanceId and
// applied one at a time, highest-occurrence-first (removals shift the index
// of any not-yet-applied lower-occurrence fix on the same property).
// ---------------------------------------------------------------------------

export interface ContactFixGroup {
	readonly instanceId: InstanceId;
	readonly fixes: ReadonlyArray<CleanupFix>;
}

const occurrenceOf = (fix: CleanupFix): number =>
	fix._tag === "SetNameCase" ? 0 : fix.occurrence;

export const buildFixGroups = (
	suggestions: ReadonlyArray<{
		readonly instanceId: InstanceId;
		readonly fix: CleanupFix;
		readonly needsInput?: string;
	}>,
): ReadonlyArray<ContactFixGroup> => {
	const byInstance = new Map<InstanceId, Array<CleanupFix>>();
	for (const s of suggestions) {
		if (s.needsInput !== undefined) {
			continue;
		}
		const existing = byInstance.get(s.instanceId);
		if (existing) {
			existing.push(s.fix);
		} else {
			byInstance.set(s.instanceId, [s.fix]);
		}
	}
	return Array.from(byInstance.entries()).map(([instanceId, fixes]) => ({
		instanceId,
		// Highest occurrence first, so a removal never invalidates a
		// not-yet-applied fix targeting a lower occurrence of the same property.
		fixes: [...fixes].sort((a, b) => occurrenceOf(b) - occurrenceOf(a)),
	}));
};

const applyGroup = (
	cleanup: ContactCleanupServiceShape,
	group: ContactFixGroup,
): Effect.Effect<{ ok: boolean }, DatabaseError, never> =>
	Effect.gen(function* () {
		let succeeded = 0;
		for (const fix of group.fixes) {
			const outcome = yield* cleanup.applyFix(group.instanceId, fix).pipe(
				Effect.as(true),
				Effect.catchTag("DavError", () => Effect.succeed(false)),
			);
			if (outcome) {
				succeeded += 1;
			}
		}
		return { ok: succeeded > 0 };
	});

const parseForm = (
	req: Request,
): Effect.Effect<{ addressbook: string; region: string }, InternalError> =>
	Effect.tryPromise({
		try: () => req.formData(),
		catch: (e) => new InternalError({ cause: e }),
	}).pipe(
		Effect.map((form) => ({
			addressbook: form.get("addressbook")?.toString() ?? "",
			region: form.get("region")?.toString() ?? "",
		})),
	);

export const contactsCleanupFixAllHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | BulkJobRepository | ContactCleanupService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const cleanup = yield* ContactCleanupService;

		const { addressbook, region: rawRegion } = yield* parseForm(req);
		const region =
			REGION_OPTIONS.find((r) => r.code === rawRegion)?.code ?? DEFAULT_REGION;
		const redirect =
			addressbook === ""
				? "/ui/contacts/cleanup"
				: `/ui/contacts/cleanup?addressbook=${encodeURIComponent(addressbook)}&region=${encodeURIComponent(region)}`;

		if (!isUuid(addressbook)) {
			return new Response(null, {
				status: HTTP_SEE_OTHER,
				headers: { Location: redirect },
			});
		}
		const collectionId = CollectionId(addressbook);

		yield* acl.check(
			principal.principalId,
			collectionId,
			"collection",
			"DAV:write-content",
		);

		const suggestions = yield* cleanup.scan(collectionId, region);
		const groups = buildFixGroups(suggestions);

		if (isHtmxRequest(ctx.headers)) {
			const job = yield* runChunkedJob({
				kind: "cleanup_fix_all",
				ownerPrincipalId: principal.principalId,
				collectionId,
				items: groups,
				input: { addressbook, region },
				perItem: (group) => applyGroup(cleanup, group),
				onDone: () => Effect.succeed({}),
			});
			return yield* renderFragment(
				<BulkJobProgress jobId={job.id} reloadOnDone />,
			);
		}

		yield* Effect.forEach(groups, (group) => applyGroup(cleanup, group), {
			concurrency: 1,
			discard: true,
		});
		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: redirect },
		});
	});
