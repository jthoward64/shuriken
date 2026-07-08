import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK, HTTP_SEE_OTHER } from "#src/http/status.ts";
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
import { contactsRedirect, parseBulkSelection } from "./bulk-shared.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/bulk-download
//
// Streams the selected contacts as a single concatenated .vcf attachment,
// mirroring the address-book export. Each selected contact's collection is
// authorized (DAV:read) before it is included; missing contacts are skipped.
//
// htmx requests are chunked via runChunkedJob: the job accumulates each
// authorized contact's VCF text, then stashes the joined bytes as the job's
// result blob (served by GET .../bulk-jobs/:id/result, evicted after 10
// minutes or on first download — see BulkJobSweepLayer). No-JS requests keep
// today's single-response download.
// ---------------------------------------------------------------------------

const BLOB_TTL_MINUTES = 10;

export const contactsBulkDownloadHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | BulkJobRepository | ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const instanceRepo = yield* InstanceRepository;

		const { ids, addressbook } = yield* parseBulkSelection(req);

		// Authorize each still-existing selection; drop the rest.
		const authorized: Array<InstanceId> = [];
		yield* Effect.forEach(
			ids,
			(id) =>
				Effect.gen(function* () {
					const instanceOpt = yield* instanceRepo.findById(id);
					if (Option.isNone(instanceOpt)) {
						return;
					}
					yield* acl.check(
						principal.principalId,
						CollectionId(instanceOpt.value.collectionId),
						"collection",
						"DAV:read",
					);
					authorized.push(id);
				}),
			{ discard: true },
		);

		// Nothing to export (empty or stale selection) — bounce back to the list.
		if (authorized.length === 0) {
			return new Response(null, {
				status: HTTP_SEE_OTHER,
				headers: { Location: contactsRedirect(addressbook) },
			});
		}

		if (isHtmxRequest(ctx.headers)) {
			const parts: Array<string> = [];
			const job = yield* runChunkedJob({
				kind: "bulk_download",
				ownerPrincipalId: principal.principalId,
				items: authorized,
				input: { addressbook },
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
		}

		const body = yield* exportInstancesToVcf(authorized);
		const bytes = new TextEncoder().encode(body);
		return new Response(bytes, {
			status: HTTP_OK,
			headers: {
				"Content-Type": "text/vcard; charset=utf-8",
				"Content-Length": String(bytes.byteLength),
				"Content-Disposition": 'attachment; filename="contacts.vcf"',
			},
		});
	});
