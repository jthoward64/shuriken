import { Duration, Effect, Option } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { someOrNotFound } from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { encodeJson } from "#src/http/ui/helpers/json.ts";
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

const SSE_ENCODER = new TextEncoder();

// Push one SSE frame onto the response body
const sendFrame = (
	controller: ReadableStreamDefaultController<Uint8Array>,
	frame: string,
): void => {
	controller.enqueue(SSE_ENCODER.encode(frame));
};

// The progress frame a status change emits
const progressFrame = (job: {
	readonly status: string;
	readonly done: number;
	readonly total: number;
	readonly succeeded: number;
	readonly failed: number;
}): string =>
	`data: ${encodeJson({
		status: job.status,
		done: job.done,
		total: job.total,
		succeeded: job.succeeded,
		failed: job.failed,
	})}\n\n`;

// Emit a keep-alive comment once the quiet period has elapsed, and report the new tick count
const heartbeatTick = (
	controller: ReadableStreamDefaultController<Uint8Array>,
	ticksSinceEvent: number,
): number => {
	if (ticksSinceEvent + 1 < HEARTBEAT_EVERY_TICKS) {
		return ticksSinceEvent + 1;
	}
	sendFrame(controller, ": heartbeat\n\n");
	return 0;
};

// Poll the job row until it reaches a terminal status or the client goes away
const pollJob = Effect.fn("ui.bulkJobEvents.poll")(function* (
	controller: ReadableStreamDefaultController<Uint8Array>,
	jobId: UuidString,
	isOpen: () => boolean,
) {
	const jobRepo = yield* BulkJobRepository;
	let lastStatus = "";
	let ticksSinceEvent = 0;
	while (isOpen()) {
		const job = Option.getOrUndefined(yield* jobRepo.findById(jobId));
		if (job === undefined) {
			return controller.close();
		}
		if (job.status === lastStatus) {
			ticksSinceEvent = heartbeatTick(controller, ticksSinceEvent);
		} else {
			lastStatus = job.status;
			ticksSinceEvent = 0;
			sendFrame(controller, progressFrame(job));
			if (isTerminal(job.status)) {
				return controller.close();
			}
		}
		yield* Effect.sleep(POLL_INTERVAL);
	}
	controller.close();
});

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

		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				pollJob(controller, jobId, () => !closed).pipe(
					Effect.catchCause((cause) => {
						controller.error(new Error(`bulk job poll failed: ${cause}`));
						return Effect.void;
					}),
					Effect.provideService(BulkJobRepository, jobRepo),
					Effect.runFork,
				);
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
