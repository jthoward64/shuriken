import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Layer, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { DatabaseError } from "#src/domain/errors.ts";
import { PrincipalId, type UuidString } from "#src/domain/ids.ts";
import { runSuccess } from "#src/testing/effect.ts";
import {
	type BulkJobCompletion,
	type BulkJobProgress,
	BulkJobRepository,
	type BulkJobRow,
	type NewBulkJob,
} from "./repository.ts";
import { runChunkedJob } from "./runner.ts";

// ---------------------------------------------------------------------------
// runChunkedJob — in-memory BulkJobRepository test double.
//
// The worker runs in a detached fiber (Effect.forkDetach) that outlives the
// call that created the job row, so tests poll the in-memory store until the
// job reaches a terminal status rather than awaiting runChunkedJob itself.
// ---------------------------------------------------------------------------

const makeTestRepoLayer = (): {
	readonly layer: Layer.Layer<BulkJobRepository>;
	readonly rows: Map<string, BulkJobRow>;
} => {
	const rows = new Map<string, BulkJobRow>();
	let counter = 0;

	const layer = Layer.succeed(BulkJobRepository, {
		create: (input: NewBulkJob) =>
			Effect.sync(() => {
				counter += 1;
				const id =
					`00000000-0000-7000-8000-${String(counter).padStart(12, "0")}` as UuidString;
				const row: BulkJobRow = {
					id,
					ownerPrincipalId: input.ownerPrincipalId,
					collectionId: input.collectionId ?? null,
					kind: input.kind,
					status: "pending",
					total: input.total,
					done: 0,
					succeeded: 0,
					failed: 0,
					input: input.input,
					result: null,
					resultBlob: null,
					resultFilename: null,
					blobExpiresAt: null,
					errorMessage: null,
					createdAt: Temporal.Now.instant(),
					updatedAt: Temporal.Now.instant(),
				};
				rows.set(id, row);
				return row;
			}),
		findById: (id: UuidString) =>
			Effect.sync(() => Option.fromNullishOr(rows.get(id))),
		markRunning: (id: UuidString) =>
			Effect.sync(() => {
				const row = rows.get(id);
				if (row) {
					rows.set(id, { ...row, status: "running" });
				}
			}),
		updateProgress: (id: UuidString, progress: BulkJobProgress) =>
			Effect.sync(() => {
				const row = rows.get(id);
				if (row) {
					rows.set(id, { ...row, ...progress });
				}
			}),
		complete: (id: UuidString, completion: BulkJobCompletion) =>
			Effect.sync(() => {
				const row = rows.get(id);
				if (row) {
					rows.set(id, {
						...row,
						status: "succeeded",
						result: completion.result ?? null,
					});
				}
			}),
		fail: (id: UuidString, message: string) =>
			Effect.sync(() => {
				const row = rows.get(id);
				if (row) {
					rows.set(id, { ...row, status: "failed", errorMessage: message });
				}
			}),
		clearBlob: () => Effect.void,
		listExpiredBlobs: () => Effect.succeed([]),
		failStaleRunning: () => Effect.void,
	});

	return { layer, rows };
};

const waitForTerminal = async (
	rows: Map<string, BulkJobRow>,
	id: string,
): Promise<BulkJobRow> => {
	for (let i = 0; i < 100; i++) {
		const row = rows.get(id);
		if (row && (row.status === "succeeded" || row.status === "failed")) {
			return row;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`job ${id} did not reach a terminal status in time`);
};

describe("runChunkedJob", () => {
	it("chunks items, tracks progress, and marks the job succeeded", async () => {
		const { layer, rows } = makeTestRepoLayer();
		const ownerPrincipalId = PrincipalId(crypto.randomUUID());

		const row = await runSuccess(
			runChunkedJob({
				kind: "bulk_delete",
				ownerPrincipalId,
				items: [1, 2, 3, 4, 5],
				input: {},
				perItem: (n) => Effect.succeed({ ok: n % 2 === 0 }),
				onDone: (outcome) => Effect.succeed({ result: outcome }),
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const final = await waitForTerminal(rows, row.id);
		expect(final.status).toBe("succeeded");
		expect(final.done).toBe(5);
		expect(final.succeeded).toBe(2);
		expect(final.failed).toBe(3);
		expect(final.result).toEqual({ succeeded: 2, failed: 3 });
	});

	it("marks the job failed when an item's effect fails (e.g. an ACL denial)", async () => {
		const { layer, rows } = makeTestRepoLayer();
		const ownerPrincipalId = PrincipalId(crypto.randomUUID());

		const row = await runSuccess(
			runChunkedJob({
				kind: "bulk_delete",
				ownerPrincipalId,
				items: [1, 2, 3],
				input: {},
				perItem: (n) =>
					n === 2
						? Effect.fail(new DatabaseError({ cause: "denied" }))
						: Effect.succeed({ ok: true }),
				onDone: () => Effect.succeed({}),
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const final = await waitForTerminal(rows, row.id);
		expect(final.status).toBe("failed");
		expect(final.errorMessage).toBeDefined();
	});
});
