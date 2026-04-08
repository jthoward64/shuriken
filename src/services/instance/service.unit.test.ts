import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { DavError } from "#src/domain/errors.ts";
import { CollectionId, EntityId, InstanceId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { HTTP_NOT_FOUND } from "#src/http/status.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { InstanceService } from "./service.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeInput = (collectionId: CollectionId, slug = "event.ics") => ({
	collectionId,
	entityId: EntityId(crypto.randomUUID()),
	contentType: "text/calendar",
	etag: ETag('"initial"'),
	slug: Slug(slug),
});

// ---------------------------------------------------------------------------
// InstanceService.put — create path (no existingId)
// ---------------------------------------------------------------------------

describe("InstanceService.put — create path", () => {
	it("inserts and returns the new instance with syncRevision 1 (simulated trigger)", async () => {
		const env = makeTestEnv();
		const collectionId = CollectionId(crypto.randomUUID());

		const result = await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) => s.put(makeInput(collectionId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.syncRevision).toBe(1);
		expect(result.slug).toBe("event.ics");
		expect(result.collectionId).toBe(collectionId);
		expect(env.stores.instances.size).toBe(1);
	});

	it("stores the provided etag verbatim", async () => {
		const env = makeTestEnv();
		const collectionId = CollectionId(crypto.randomUUID());

		const result = await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) =>
					s.put({ ...makeInput(collectionId), etag: ETag('"abc-123"') }),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.etag).toBe('"abc-123"');
	});
});

// ---------------------------------------------------------------------------
// InstanceService.put — update path (with existingId)
// ---------------------------------------------------------------------------

describe("InstanceService.put — update path", () => {
	it("increments syncRevision by 1 and sets the new etag", async () => {
		const env = makeTestEnv();
		const collectionId = CollectionId(crypto.randomUUID());
		const instanceId = crypto.randomUUID();
		env.withInstance({
			id: instanceId,
			collectionId,
			etag: '"v1"',
		});

		const result = await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) =>
					s.put(
						{ ...makeInput(collectionId), etag: ETag('"v2"') },
						InstanceId(instanceId),
					),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.syncRevision).toBe(1);
		expect(result.etag).toBe('"v2"');
	});

	it("second update increments syncRevision to 2 (not stuck at 1)", async () => {
		const env = makeTestEnv();
		const collectionId = CollectionId(crypto.randomUUID());
		const instanceId = crypto.randomUUID();
		env.withInstance({ id: instanceId, collectionId });
		const layer = env.toLayer();

		// First update: 0 → 1
		await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) =>
					s.put(
						{ ...makeInput(collectionId), etag: ETag('"v2"') },
						InstanceId(instanceId),
					),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		// Second update: 1 → 2
		const result = await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) =>
					s.put(
						{ ...makeInput(collectionId), etag: ETag('"v3"') },
						InstanceId(instanceId),
					),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result.syncRevision).toBe(2);
		expect(result.etag).toBe('"v3"');
	});

	it("fails with 404 when the existingId does not exist", async () => {
		const env = makeTestEnv();
		const collectionId = CollectionId(crypto.randomUUID());

		const err = (await runFailure(
			InstanceService.pipe(
				Effect.flatMap((s) =>
					s.put(makeInput(collectionId), InstanceId(crypto.randomUUID())),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// InstanceService.delete
// ---------------------------------------------------------------------------

describe("InstanceService.delete", () => {
	it("soft-deletes an existing instance (deletedAt is set)", async () => {
		const env = makeTestEnv();
		const instanceId = crypto.randomUUID();
		env.withInstance({
			id: instanceId,
			collectionId: CollectionId(crypto.randomUUID()),
		});

		await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) => s.delete(InstanceId(instanceId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(env.stores.instances.get(instanceId)?.deletedAt).not.toBeNull();
	});

	it("fails with 404 when the instance does not exist", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			InstanceService.pipe(
				Effect.flatMap((s) => s.delete(InstanceId(crypto.randomUUID()))),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// InstanceService.findById
// ---------------------------------------------------------------------------

describe("InstanceService.findById", () => {
	it("returns the instance when found", async () => {
		const env = makeTestEnv();
		const instanceId = crypto.randomUUID();
		env.withInstance({
			id: instanceId,
			collectionId: CollectionId(crypto.randomUUID()),
			slug: "event.ics",
		});

		const result = await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) => s.findById(InstanceId(instanceId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.id).toBe(instanceId);
		expect(result.slug).toBe("event.ics");
	});

	it("fails with 404 for an unknown id", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			InstanceService.pipe(
				Effect.flatMap((s) => s.findById(InstanceId(crypto.randomUUID()))),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// InstanceService.findBySlug
// ---------------------------------------------------------------------------

describe("InstanceService.findBySlug", () => {
	it("returns the instance when found", async () => {
		const env = makeTestEnv();
		const collectionId = CollectionId(crypto.randomUUID());
		env.withInstance({ collectionId, slug: "contact.vcf" });

		const result = await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) => s.findBySlug(collectionId, Slug("contact.vcf"))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.slug).toBe("contact.vcf");
	});

	it("fails with 404 for an unknown slug", async () => {
		const env = makeTestEnv();
		const collectionId = CollectionId(crypto.randomUUID());

		const err = (await runFailure(
			InstanceService.pipe(
				Effect.flatMap((s) => s.findBySlug(collectionId, Slug("missing.ics"))),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// InstanceService.listByCollection
// ---------------------------------------------------------------------------

describe("InstanceService.listByCollection", () => {
	it("returns all non-deleted instances in the collection", async () => {
		const env = makeTestEnv();
		const collectionId = CollectionId(crypto.randomUUID());
		env
			.withInstance({ collectionId, slug: "a.ics" })
			.withInstance({ collectionId, slug: "b.ics" });

		const result = await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) => s.listByCollection(collectionId)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toHaveLength(2);
		const slugs = [...result].map((i) => i.slug).sort();
		expect(slugs).toEqual(["a.ics", "b.ics"]);
	});

	it("returns an empty array for a collection with no instances", async () => {
		const env = makeTestEnv();
		const collectionId = CollectionId(crypto.randomUUID());

		const result = await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) => s.listByCollection(collectionId)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toHaveLength(0);
	});

	it("excludes instances belonging to a different collection", async () => {
		const env = makeTestEnv();
		const collectionA = CollectionId(crypto.randomUUID());
		const collectionB = CollectionId(crypto.randomUUID());
		env
			.withInstance({ collectionId: collectionA, slug: "a.ics" })
			.withInstance({ collectionId: collectionB, slug: "b.ics" });

		const result = await runSuccess(
			InstanceService.pipe(
				Effect.flatMap((s) => s.listByCollection(collectionA)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toHaveLength(1);
		expect(result[0]?.slug).toBe("a.ics");
	});
});
