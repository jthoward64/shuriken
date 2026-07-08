import { Effect } from "effect";
import {
	badRequest,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, InstanceId, isUuid } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_SEE_OTHER } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { MergeResult } from "#src/http/ui/view/pages/contacts/merge.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/service.ts";
import { ContactMergeService } from "#src/services/contact-merge/service.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/merge   (form field: ids=<comma-separated instanceIds>)
//
// Merges the given duplicate contacts into one. The caller must hold
// DAV:write-content and DAV:unbind on every collection whose contacts are
// involved (the primary is rewritten, the rest are unbound).
// ---------------------------------------------------------------------------

const MIN_MERGE_MEMBERS = 2;

export const contactsMergeExecuteHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ContactMergeService | InstanceService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const mergeSvc = yield* ContactMergeService;
		const instanceSvc = yield* InstanceService;

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const raw = form.get("ids")?.toString() ?? "";
		const parts = raw
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s !== "");
		if (parts.length < MIN_MERGE_MEMBERS) {
			return yield* Effect.fail(
				badRequest("select at least two contacts to merge"),
			);
		}
		if (!parts.every(isUuid)) {
			return yield* Effect.fail(badRequest("invalid contact id"));
		}
		const instanceIds = parts.map((p) => InstanceId(p));

		// Authorize against every collection the selected contacts live in.
		const rows = yield* Effect.forEach(instanceIds, (id) =>
			instanceSvc.findById(id),
		);
		const collectionIds = [...new Set(rows.map((r) => r.collectionId))];
		yield* Effect.forEach(collectionIds, (cid) =>
			Effect.gen(function* () {
				yield* acl.check(
					principal.principalId,
					CollectionId(cid),
					"collection",
					"DAV:write-content",
				);
				yield* acl.check(
					principal.principalId,
					CollectionId(cid),
					"collection",
					"DAV:unbind",
				);
			}),
		);

		const result = yield* mergeSvc.merge(instanceIds);

		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<MergeResult
					fn={result.fn ?? "(no name)"}
					mergedCount={result.mergedCount}
				/>,
			);
		}
		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: "/ui/contacts/merge" },
		});
	});
