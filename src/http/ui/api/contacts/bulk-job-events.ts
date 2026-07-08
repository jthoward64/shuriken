import { Duration, Effect, Option } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { someOrNotFound } from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { BulkJobRepository } from "#src/services/bulk-job/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/api/contacts/bulk-jobs/:jobId/events
//
// Server-Sent Events stream of a bulk job's progress. Polls the bulk_job row
// every POLL_INTERVAL_MS and emits an SSE frame whenever status/counts change,
// closing once the job reaches a terminal status. A client reconnecting after
// a page reload gets current progress straight from the DB row rather than
// needing the original connection — the job itself runs in a detached fiber
// (see runChunkedJob) independent of any SSE reader.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 15_000;
const POLL_INTERVAL = Duration.millis(POLL_INTERVAL_MS);
const HEARTBEAT_EVERY_TICKS = HEARTBEAT_INTERVAL_MS / POLL_INTERVAL_MS;

const isTerminal = (status: string): boolean =>
	status === "succeeded" || status === "failed";

export const contactsBulkJobEventsHandler = (
	req: Request,
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
		yield* someOrNotFound(`Bulk job not found: ${jobId}`)(owned);

		let closed = false;
		req.signal.addEventListener("abort", () => {
			closed = true;
		});

		const encoder = new TextEncoder();

		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				const poll = Effect.gen(function* () {
					let lastStatus = "";
					let ticksSinceEvent = 0;
					while (!closed) {
						const current = yield* jobRepo.findById(jobId);
						const job = Option.getOrUndefined(current);
						if (job === undefined) {
							controller.close();
							return;
						}
						if (job.status !== lastStatus) {
							lastStatus = job.status;
							ticksSinceEvent = 0;
							controller.enqueue(
								encoder.encode(
									`data: ${JSON.stringify({
										status: job.status,
										done: job.done,
										total: job.total,
										succeeded: job.succeeded,
										failed: job.failed,
									})}\n\n`,
								),
							);
							if (isTerminal(job.status)) {
								controller.close();
								return;
							}
						} else {
							ticksSinceEvent += 1;
							if (ticksSinceEvent >= HEARTBEAT_EVERY_TICKS) {
								ticksSinceEvent = 0;
								controller.enqueue(encoder.encode(": heartbeat\n\n"));
							}
						}
						yield* Effect.sleep(POLL_INTERVAL);
					}
					controller.close();
				}).pipe(
					Effect.catchCause((cause) => {
						controller.error(new Error(`bulk job poll failed: ${cause}`));
						return Effect.void;
					}),
				);
				Effect.runFork(Effect.provideService(poll, BulkJobRepository, jobRepo));
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	});
