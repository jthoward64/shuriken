import { Effect, Option } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { someOrNotFound } from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { BulkJobRepository } from "#src/services/bulk-job/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/api/contacts/bulk-jobs/:jobId/result
//
// Serves the finished .vcf blob for a file-producing bulk job (export /
// bulk-download), then evicts it — the blob is meant to be downloaded once;
// the periodic sweep (BulkJobSweepLayer) also evicts it after its TTL if it's
// never downloaded.
// ---------------------------------------------------------------------------

export const contactsBulkJobResultHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	jobId: UuidString,
): Effect.Effect<Response, DavError | DatabaseError, BulkJobRepository> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const jobRepo = yield* BulkJobRepository;

		const jobOpt = yield* jobRepo.findById(jobId);
		const owned = Option.filter(
			jobOpt,
			(j) => j.ownerPrincipalId === principal.principalId,
		);
		const job = yield* someOrNotFound(`Bulk job not found: ${jobId}`)(owned);
		const blob = yield* someOrNotFound(
			`Bulk job result not available: ${jobId}`,
		)(Option.fromNullishOr(job.resultBlob));

		yield* jobRepo.clearBlob(jobId);

		const filename = job.resultFilename ?? "contacts.vcf";
		return new Response(new Uint8Array(blob), {
			status: HTTP_OK,
			headers: {
				"Content-Type": "text/vcard; charset=utf-8",
				"Content-Length": String(blob.byteLength),
				"Content-Disposition": `attachment; filename="${filename}"`,
			},
		});
	});
