import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { CollectionId, InstanceId, PrincipalId } from "#src/domain/ids.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";

// ---------------------------------------------------------------------------
// Trash purge sweep — repository-level coverage.
//
// TrashPurgeLayer itself is a scheduled background fiber (Layer.unwrap +
// Schedule.spaced + forkScoped), which isn't practical to exercise directly in
// a unit test. Instead this replicates the sweep's query logic — the same
// calls purge.live.ts makes each tick — directly against the in-memory test
// repositories, manipulating `deletedAt` timestamps rather than waiting on
// real time. This proves the retention-window filtering the sweep depends on.
// ---------------------------------------------------------------------------

const setCollectionDeletedAt = (
	env: ReturnType<typeof makeTestEnv>,
	id: string,
	deletedAt: Temporal.Instant,
) => {
	const row = env.stores.collections.get(id);
	if (row) {
		env.stores.collections.set(id, { ...row, deletedAt });
	}
};

const setInstanceDeletedAt = (
	env: ReturnType<typeof makeTestEnv>,
	id: string,
	deletedAt: Temporal.Instant,
) => {
	const row = env.stores.instances.get(id);
	if (row) {
		env.stores.instances.set(id, { ...row, deletedAt });
	}
};

describe("trash purge sweep", () => {
	it("only returns/removes collections past the retention window", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const oldId = crypto.randomUUID();
		const recentId = crypto.randomUUID();
		env
			.withUser({ principalId })
			.withCollection({ id: oldId, ownerPrincipalId: principalId })
			.withCollection({ id: recentId, ownerPrincipalId: principalId });

		const now = Temporal.Now.instant();
		setCollectionDeletedAt(env, oldId, now.subtract({ hours: 24 * 40 })); // 40 days ago
		setCollectionDeletedAt(env, recentId, now.subtract({ hours: 24 * 2 })); // 2 days ago

		const cutoff = now.subtract({ hours: 24 * 30 }); // 30-day retention

		const expired = await runSuccess(
			CollectionRepository.pipe(
				Effect.flatMap((repo) => repo.listDeletedOlderThan(cutoff)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(expired.map((c) => c.id)).toEqual([oldId]);

		await runSuccess(
			CollectionRepository.pipe(
				Effect.flatMap((repo) => repo.hardDelete(CollectionId(oldId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(env.stores.collections.has(oldId)).toBe(false);
		expect(env.stores.collections.has(recentId)).toBe(true);
	});

	it("only returns/removes instances past the retention window", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		const oldId = crypto.randomUUID();
		const recentId = crypto.randomUUID();
		env
			.withUser({ principalId })
			.withCollection({ id: collectionId, ownerPrincipalId: principalId })
			.withInstance({ id: oldId, collectionId })
			.withInstance({ id: recentId, collectionId });

		const now = Temporal.Now.instant();
		setInstanceDeletedAt(env, oldId, now.subtract({ hours: 24 * 40 }));
		setInstanceDeletedAt(env, recentId, now.subtract({ hours: 24 * 2 }));

		const cutoff = now.subtract({ hours: 24 * 30 });

		const expired = await runSuccess(
			InstanceRepository.pipe(
				Effect.flatMap((repo) => repo.listDeletedOlderThan(cutoff)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(expired.map((i) => i.id)).toEqual([oldId]);

		await runSuccess(
			InstanceRepository.pipe(
				Effect.flatMap((repo) => repo.hardDelete(InstanceId(oldId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(env.stores.instances.has(oldId)).toBe(false);
		expect(env.stores.instances.has(recentId)).toBe(true);
	});
});
