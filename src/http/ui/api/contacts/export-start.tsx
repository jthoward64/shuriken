import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { type CollectionId, InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_SEE_OTHER } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { BulkJobProgress } from "#src/http/ui/view/pages/contacts/list.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/service.ts";
import {
	type BulkJobRepository,
	runChunkedJob,
} from "#src/services/bulk-job/index.ts";
import { exportInstancesToVcf } from "#src/services/card-edit/export-vcf.ts";
import type { ComponentRepository } from "#src/services/component/repository.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/export?addressbook=<collectionId>
//
// The htmx-driven counterpart to GET /ui/contacts/export.vcf (kept as the
// no-JS fallback, unchanged and still fully synchronous — see
// handlers/contacts/export.ts). Chunks the whole address book through
// runChunkedJob the same way bulk-download does for a selection.
// ---------------------------------------------------------------------------

const BLOB_TTL_MINUTES = 10;

export const contactsExportStartHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | BulkJobRepository | ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const instanceRepo = yield* InstanceRepository;

		yield* acl.check(
			principal.principalId,
			collectionId,
			"collection",
			"DAV:read",
		);

		if (!isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: HTTP_SEE_OTHER,
				headers: {
					Location: `/ui/contacts/export.vcf?addressbook=${collectionId}`,
				},
			});
		}

		const instances = yield* instanceRepo.listByCollection(collectionId);
		const ids = instances
			.filter(
				(i) =>
					i.deletedAt === null &&
					i.contentType.split(";")[0]?.trim().toLowerCase() === "text/vcard",
			)
			.map((i) => InstanceId(i.id));

		const parts: Array<string> = [];
		const job = yield* runChunkedJob({
			kind: "export",
			ownerPrincipalId: principal.principalId,
			collectionId,
			items: ids,
			input: { addressbook: collectionId },
			perItem: (id) =>
				exportInstancesToVcf([id]).pipe(
					Effect.map((text) => {
						parts.push(text);
						return { ok: true };
					}),
				),
			onDone: () =>
				Effect.sync(() => ({
					resultBlob: new TextEncoder().encode(parts.join("")),
					resultFilename: "contacts.vcf",
					blobExpiresAt: Temporal.Now.instant().add(
						Temporal.Duration.from({ minutes: BLOB_TTL_MINUTES }),
					),
				})),
		});
		return yield* renderFragment(
			<BulkJobProgress
				jobId={job.id}
				resultUrl={`/ui/api/contacts/bulk-jobs/${job.id}/result`}
			/>,
		);
	});
