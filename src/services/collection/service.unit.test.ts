import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { DavError } from "#src/domain/errors.ts";
import { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { HTTP_CONFLICT, HTTP_NOT_FOUND } from "#src/http/status.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { CollectionService } from "./service.ts";

/** Narrows a test failure to a DavError so its status can be asserted. */
const asDavError = (err: unknown): DavError => {
	if (err instanceof DavError) {
		return err;
	}
	throw new Error(`expected a DavError, got ${String(err)}`);
};

// ---------------------------------------------------------------------------
// CollectionService.create
// ---------------------------------------------------------------------------

describe("CollectionService.create", () => {
	it("inserts and returns the new collection", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		env.withUser({ principalId });

		const result = await runSuccess(
			CollectionService.pipe(
				Effect.flatMap((s) =>
					s.create({
						ownerPrincipalId: principalId,
						collectionType: "calendar",
						slug: Slug("my-cal"),
						displayName: "My Calendar",
					}),
				),
				Effect.orDie,
			),
			env.toLayer(),
		);

		expect(result.slug).toBe("my-cal");
		expect(result.displayName).toBe("My Calendar");
		expect(result.collectionType).toBe("calendar");
		expect(result.ownerPrincipalId).toBe(principalId);
		expect(env.stores.collections.size).toBe(1);
	});

	it("fails with 409 when an owner+slug combination already exists", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		env.withUser({ principalId }).withCollection({
			ownerPrincipalId: principalId,
			slug: "existing",
		});

		const err = asDavError(
			await runFailure(
				CollectionService.pipe(
					Effect.flatMap((s) =>
						s.create({
							ownerPrincipalId: principalId,
							collectionType: "calendar",
							slug: Slug("existing"),
						}),
					),
				),
				env.toLayer(),
			),
		);

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_CONFLICT);
	});

	it("a different slug on the same owner succeeds alongside the first", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		env.withUser({ principalId }).withCollection({
			ownerPrincipalId: principalId,
			slug: "first",
		});

		await runSuccess(
			CollectionService.pipe(
				Effect.flatMap((s) =>
					s.create({
						ownerPrincipalId: principalId,
						collectionType: "addressbook",
						slug: Slug("second"),
					}),
				),
				Effect.orDie,
			),
			env.toLayer(),
		);

		expect(env.stores.collections.size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// CollectionService.delete
// ---------------------------------------------------------------------------

describe("CollectionService.delete", () => {
	it("soft-deletes an existing collection (deletedAt is set)", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		env.withUser({ principalId }).withCollection({
			id: collectionId,
			ownerPrincipalId: principalId,
		});

		await runSuccess(
			CollectionService.pipe(
				Effect.flatMap((s) => s.delete(CollectionId(collectionId))),
				Effect.orDie,
			),
			env.toLayer(),
		);

		expect(env.stores.collections.get(collectionId)?.deletedAt).not.toBeNull();
	});

	it("fails with 404 when the collection does not exist", async () => {
		const env = makeTestEnv();

		const err = asDavError(
			await runFailure(
				CollectionService.pipe(
					Effect.flatMap((s) => s.delete(CollectionId(crypto.randomUUID()))),
				),
				env.toLayer(),
			),
		);

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// CollectionService.findById
// ---------------------------------------------------------------------------

describe("CollectionService.findById", () => {
	it("returns the collection when found", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		env.withUser({ principalId }).withCollection({
			id: collectionId,
			ownerPrincipalId: principalId,
			slug: "cal",
		});

		const result = await runSuccess(
			CollectionService.pipe(
				Effect.flatMap((s) => s.findById(CollectionId(collectionId))),
				Effect.orDie,
			),
			env.toLayer(),
		);

		expect(result.id).toBe(collectionId);
		expect(result.slug).toBe("cal");
	});

	it("fails with 404 for an unknown id", async () => {
		const env = makeTestEnv();

		const err = asDavError(
			await runFailure(
				CollectionService.pipe(
					Effect.flatMap((s) => s.findById(CollectionId(crypto.randomUUID()))),
				),
				env.toLayer(),
			),
		);

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// CollectionService.findBySlug
// ---------------------------------------------------------------------------

describe("CollectionService.findBySlug", () => {
	it("returns the collection when found", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		env.withUser({ principalId }).withCollection({
			ownerPrincipalId: principalId,
			collectionType: "calendar",
			slug: "my-cal",
		});

		const result = await runSuccess(
			CollectionService.pipe(
				Effect.flatMap((s) =>
					s.findBySlug(principalId, "calendar", Slug("my-cal")),
				),
				Effect.orDie,
			),
			env.toLayer(),
		);

		expect(result.slug).toBe("my-cal");
		expect(result.ownerPrincipalId).toBe(principalId);
	});

	it("fails with 404 for an unknown slug", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		env.withUser({ principalId });

		const err = asDavError(
			await runFailure(
				CollectionService.pipe(
					Effect.flatMap((s) =>
						s.findBySlug(principalId, "calendar", Slug("no-such-cal")),
					),
				),
				env.toLayer(),
			),
		);

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// CollectionService.listByOwner
// ---------------------------------------------------------------------------

describe("CollectionService.listByOwner", () => {
	it("returns an empty array when the owner has no collections", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		env.withUser({ principalId });

		const result = await runSuccess(
			CollectionService.pipe(
				Effect.flatMap((s) => s.listByOwner(principalId)),
				Effect.orDie,
			),
			env.toLayer(),
		);

		expect(result).toHaveLength(0);
	});

	it("returns only the requesting owner's collections, not another owner's", async () => {
		const env = makeTestEnv();
		const alicePrincipalId = PrincipalId(crypto.randomUUID());
		const bobPrincipalId = PrincipalId(crypto.randomUUID());
		env
			.withUser({ principalId: alicePrincipalId })
			.withUser({ principalId: bobPrincipalId })
			.withCollection({ ownerPrincipalId: alicePrincipalId, slug: "alice-cal" })
			.withCollection({ ownerPrincipalId: bobPrincipalId, slug: "bob-cal" });

		const aliceResult = await runSuccess(
			CollectionService.pipe(
				Effect.flatMap((s) => s.listByOwner(alicePrincipalId)),
				Effect.orDie,
			),
			env.toLayer(),
		);

		expect(aliceResult).toHaveLength(1);
		expect(aliceResult[0]?.slug).toBe("alice-cal");
	});

	it("excludes soft-deleted collections", async () => {
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

		// Soft-delete via the service so deletedAt is set
		await runSuccess(
			CollectionService.pipe(
				Effect.flatMap((s) => s.delete(CollectionId(deletedId))),
				Effect.orDie,
			),
			env.toLayer(),
		);

		const result = await runSuccess(
			Effect.provide(
				CollectionService.pipe(
					Effect.flatMap((s) => s.listByOwner(principalId)),
				),
				env.toLayer(),
			).pipe(Effect.orDie),
		);

		expect(result).toHaveLength(1);
		expect(result[0]?.slug).toBe("kept");
	});
});
