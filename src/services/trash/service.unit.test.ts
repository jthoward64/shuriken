import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { CollectionId, InstanceId, PrincipalId } from "#src/domain/ids.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { TrashNotFound, TrashNotOwner } from "./error.ts";
import { TrashServiceLive } from "./service.live.ts";
import { TrashService } from "./service.ts";

// ---------------------------------------------------------------------------
// TrashService — unit tests against the in-memory test environment.
// ---------------------------------------------------------------------------

const layerFor = (env: ReturnType<typeof makeTestEnv>) =>
	TrashServiceLive.pipe(Layer.provide(env.toLayer()));

describe("TrashService.listTrash", () => {
	it("includes deleted collections and excludes active ones", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const deletedId = crypto.randomUUID();
		env
			.withUser({ principalId })
			.withCollection({ ownerPrincipalId: principalId, slug: "kept" })
			.withCollection({
				id: deletedId,
				ownerPrincipalId: principalId,
				slug: "gone",
			});

		// Soft-delete one collection directly in the store to set up the fixture.
		const row = env.stores.collections.get(deletedId);
		if (row) {
			env.stores.collections.set(deletedId, {
				...row,
				deletedAt: Temporal.Now.instant(),
			});
		}

		const result = await runSuccess(
			TrashService.pipe(
				Effect.flatMap((s) => s.listTrash(principalId)),
				Effect.provide(layerFor(env)),
				Effect.orDie,
			),
		);

		expect(result.collections).toHaveLength(1);
		expect(result.collections[0]?.id).toBe(deletedId);
	});

	it("includes deleted instances under both active and deleted collections", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const activeCollectionId = crypto.randomUUID();
		const deletedCollectionId = crypto.randomUUID();
		const deletedInstanceUnderActiveId = crypto.randomUUID();
		const deletedInstanceUnderDeletedId = crypto.randomUUID();
		const activeInstanceId = crypto.randomUUID();

		env
			.withUser({ principalId })
			.withCollection({ id: activeCollectionId, ownerPrincipalId: principalId })
			.withCollection({
				id: deletedCollectionId,
				ownerPrincipalId: principalId,
			})
			.withInstance({
				id: deletedInstanceUnderActiveId,
				collectionId: activeCollectionId,
				slug: "deleted-under-active.ics",
			})
			.withInstance({
				id: deletedInstanceUnderDeletedId,
				collectionId: deletedCollectionId,
				slug: "deleted-under-deleted.ics",
			})
			.withInstance({
				id: activeInstanceId,
				collectionId: activeCollectionId,
				slug: "still-active.ics",
			});

		for (const id of [
			deletedInstanceUnderActiveId,
			deletedInstanceUnderDeletedId,
		]) {
			const row = env.stores.instances.get(id);
			if (row) {
				env.stores.instances.set(id, {
					...row,
					deletedAt: Temporal.Now.instant(),
				});
			}
		}
		const collectionRow = env.stores.collections.get(deletedCollectionId);
		if (collectionRow) {
			env.stores.collections.set(deletedCollectionId, {
				...collectionRow,
				deletedAt: Temporal.Now.instant(),
			});
		}

		const result = await runSuccess(
			TrashService.pipe(
				Effect.flatMap((s) => s.listTrash(principalId)),
				Effect.provide(layerFor(env)),
				Effect.orDie,
			),
		);

		const instanceIds = result.instances.map((i) => i.id).sort();
		expect(instanceIds).toEqual(
			[deletedInstanceUnderActiveId, deletedInstanceUnderDeletedId].sort(),
		);
	});
});

describe("TrashService.restoreCollection", () => {
	it("clears deletedAt so the collection reappears in normal listings", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		env.withUser({ principalId }).withCollection({
			id: collectionId,
			ownerPrincipalId: principalId,
		});
		const row = env.stores.collections.get(collectionId);
		if (row) {
			env.stores.collections.set(collectionId, {
				...row,
				deletedAt: Temporal.Now.instant(),
			});
		}

		await runSuccess(
			TrashService.pipe(
				Effect.flatMap((s) =>
					s.restoreCollection(CollectionId(collectionId), principalId),
				),
				Effect.provide(layerFor(env)),
				Effect.orDie,
			),
		);

		expect(env.stores.collections.get(collectionId)?.deletedAt).toBeNull();
	});

	it("rejects a non-owner caller with TrashNotOwner", async () => {
		const env = makeTestEnv();
		const ownerId = PrincipalId(crypto.randomUUID());
		const otherId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		env
			.withUser({ principalId: ownerId })
			.withUser({ principalId: otherId })
			.withCollection({ id: collectionId, ownerPrincipalId: ownerId });
		const row = env.stores.collections.get(collectionId);
		if (row) {
			env.stores.collections.set(collectionId, {
				...row,
				deletedAt: Temporal.Now.instant(),
			});
		}

		const err = await runFailure(
			TrashService.pipe(
				Effect.flatMap((s) =>
					s.restoreCollection(CollectionId(collectionId), otherId),
				),
				Effect.provide(layerFor(env)),
			),
		);

		expect(err).toBeInstanceOf(TrashNotOwner);
	});

	it("fails with TrashNotFound for a nonexistent id", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		env.withUser({ principalId });

		const err = await runFailure(
			TrashService.pipe(
				Effect.flatMap((s) =>
					s.restoreCollection(CollectionId(crypto.randomUUID()), principalId),
				),
				Effect.provide(layerFor(env)),
			),
		);

		expect(err).toBeInstanceOf(TrashNotFound);
	});
});

describe("TrashService.purgeCollectionForever", () => {
	it("removes the collection permanently", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		env.withUser({ principalId }).withCollection({
			id: collectionId,
			ownerPrincipalId: principalId,
		});
		const row = env.stores.collections.get(collectionId);
		if (row) {
			env.stores.collections.set(collectionId, {
				...row,
				deletedAt: Temporal.Now.instant(),
			});
		}

		await runSuccess(
			TrashService.pipe(
				Effect.flatMap((s) =>
					s.purgeCollectionForever(CollectionId(collectionId), principalId),
				),
				Effect.provide(layerFor(env)),
				Effect.orDie,
			),
		);

		expect(env.stores.collections.has(collectionId)).toBe(false);
	});

	it("rejects a non-owner caller with TrashNotOwner", async () => {
		const env = makeTestEnv();
		const ownerId = PrincipalId(crypto.randomUUID());
		const otherId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		env
			.withUser({ principalId: ownerId })
			.withUser({ principalId: otherId })
			.withCollection({ id: collectionId, ownerPrincipalId: ownerId });
		const row = env.stores.collections.get(collectionId);
		if (row) {
			env.stores.collections.set(collectionId, {
				...row,
				deletedAt: Temporal.Now.instant(),
			});
		}

		const err = await runFailure(
			TrashService.pipe(
				Effect.flatMap((s) =>
					s.purgeCollectionForever(CollectionId(collectionId), otherId),
				),
				Effect.provide(layerFor(env)),
			),
		);

		expect(err).toBeInstanceOf(TrashNotOwner);
		expect(env.stores.collections.has(collectionId)).toBe(true);
	});
});

describe("TrashService.restoreInstance / purgeInstanceForever", () => {
	it("restore clears deletedAt so the instance reappears in normal listings", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		const instanceId = crypto.randomUUID();
		env
			.withUser({ principalId })
			.withCollection({ id: collectionId, ownerPrincipalId: principalId })
			.withInstance({ id: instanceId, collectionId });
		const row = env.stores.instances.get(instanceId);
		if (row) {
			env.stores.instances.set(instanceId, {
				...row,
				deletedAt: Temporal.Now.instant(),
			});
		}

		await runSuccess(
			TrashService.pipe(
				Effect.flatMap((s) =>
					s.restoreInstance(InstanceId(instanceId), principalId),
				),
				Effect.provide(layerFor(env)),
				Effect.orDie,
			),
		);

		expect(env.stores.instances.get(instanceId)?.deletedAt).toBeNull();
	});

	it("rejects a non-owner caller (owner determined via parent collection)", async () => {
		const env = makeTestEnv();
		const ownerId = PrincipalId(crypto.randomUUID());
		const otherId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		const instanceId = crypto.randomUUID();
		env
			.withUser({ principalId: ownerId })
			.withUser({ principalId: otherId })
			.withCollection({ id: collectionId, ownerPrincipalId: ownerId })
			.withInstance({ id: instanceId, collectionId });
		const row = env.stores.instances.get(instanceId);
		if (row) {
			env.stores.instances.set(instanceId, {
				...row,
				deletedAt: Temporal.Now.instant(),
			});
		}

		const err = await runFailure(
			TrashService.pipe(
				Effect.flatMap((s) =>
					s.purgeInstanceForever(InstanceId(instanceId), otherId),
				),
				Effect.provide(layerFor(env)),
			),
		);

		expect(err).toBeInstanceOf(TrashNotOwner);
	});

	it("purge fails with TrashNotFound for a nonexistent id", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		env.withUser({ principalId });

		const err = await runFailure(
			TrashService.pipe(
				Effect.flatMap((s) =>
					s.purgeInstanceForever(InstanceId(crypto.randomUUID()), principalId),
				),
				Effect.provide(layerFor(env)),
			),
		);

		expect(err).toBeInstanceOf(TrashNotFound);
	});
});
