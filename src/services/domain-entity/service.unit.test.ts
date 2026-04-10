import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { ComponentId, EntityId } from "#src/domain/ids.ts";
import type { ComponentRepositoryShape } from "#src/services/component/repository.ts";
import { ComponentRepository } from "#src/services/component/repository.ts";
import type {
	EntityRepositoryShape,
	EntityRow,
} from "#src/services/entity/repository.ts";
import { EntityRepository } from "#src/services/entity/repository.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { DomainEntityServiceLive } from "./service.live.ts";
import { DomainEntityService } from "./service.ts";

// ---------------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------------

const makeTestEntityRepository = () => {
	const store = new Map<string, EntityRow>();

	const repo: EntityRepositoryShape = {
		insert: ({ entityType, logicalUid }) => {
			const id = crypto.randomUUID();
			const row: EntityRow = {
				id,
				entityType,
				logicalUid: logicalUid ?? null,
				updatedAt: null as unknown as EntityRow["updatedAt"],
				deletedAt: null,
			};
			store.set(id, row);
			return Effect.succeed(row);
		},
		findById: (id) => {
			const row = store.get(id);
			if (!row) {
				return Effect.succeed(Option.none());
			}
			return Effect.succeed(Option.some(row));
		},
		updateLogicalUid: (id, uid) => {
			const row = store.get(id);
			if (row) {
				store.set(id, { ...row, logicalUid: uid });
			}
			return Effect.void;
		},
		softDelete: (id) => {
			store.delete(id);
			return Effect.void;
		},
		existsByUid: (_collectionId, _logicalUid) => Effect.succeed(false),
		existsByUidForPrincipal: (_principalId, _logicalUid) => Effect.succeed(false),
	};

	return { repo, store };
};

const makeTestComponentRepository = () => {
	const store = new Map<string, IrComponent>();

	const repo: ComponentRepositoryShape = {
		insertTree: (entityId, root) => {
			store.set(entityId, root);
			return Effect.succeed(ComponentId(crypto.randomUUID()));
		},
		loadTree: (entityId, _entityType) => {
			const tree = store.get(entityId);
			return Effect.succeed(
				tree !== undefined ? Option.some(tree) : Option.none(),
			);
		},
		deleteByEntity: (entityId) => {
			store.delete(entityId);
			return Effect.void;
		},
	};

	return { repo, store };
};

const makeTestLayer = (
	entityDouble: EntityRepositoryShape,
	compDouble: ComponentRepositoryShape,
) =>
	DomainEntityServiceLive.pipe(
		Layer.provide(Layer.succeed(EntityRepository, entityDouble)),
		Layer.provide(Layer.succeed(ComponentRepository, compDouble)),
	);

// ---------------------------------------------------------------------------
// Sample documents
// ---------------------------------------------------------------------------

const minimalIcalDocument = (uid?: string): IrDocument => ({
	kind: "icalendar",
	root: {
		name: "VCALENDAR",
		properties: [],
		components: uid
			? [
					{
						name: "VEVENT",
						properties: [
							{
								name: "UID",
								parameters: [],
								value: { type: "TEXT", value: uid },
								isKnown: true,
							},
							{
								name: "SUMMARY",
								parameters: [],
								value: { type: "TEXT", value: "Test event" },
								isKnown: true,
							},
						],
						components: [],
					},
				]
			: [],
	},
});

const minimalVcardDocument = (uid?: string): IrDocument => ({
	kind: "vcard",
	root: {
		name: "VCARD",
		properties: [
			{
				name: "FN",
				parameters: [],
				value: { type: "TEXT", value: "Alice" },
				isKnown: true,
			},
			...(uid
				? [
						{
							name: "UID",
							parameters: [] as IrComponent["properties"][0]["parameters"],
							value: { type: "URI" as const, value: `urn:uuid:${uid}` },
							isKnown: true,
						},
					]
				: []),
		],
		components: [],
	},
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("DomainEntityService.create", () => {
	it("inserts entity and component tree; returns the new EntityId", async () => {
		const { repo: entityRepo, store: entityStore } = makeTestEntityRepository();
		const { repo: compRepo, store: compStore } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);

		const entityId = await runSuccess(
			DomainEntityService.pipe(
				Effect.flatMap((s) =>
					s.create({
						entityType: "icalendar",
						document: minimalIcalDocument(),
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(entityId).toBeString();
		expect(entityStore.size).toBe(1);
		expect(compStore.size).toBe(1);
	});

	it("sets logicalUid from the document UID when present (iCalendar)", async () => {
		const { repo: entityRepo, store: entityStore } = makeTestEntityRepository();
		const { repo: compRepo } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);

		const entityId = await runSuccess(
			DomainEntityService.pipe(
				Effect.flatMap((s) =>
					s.create({
						entityType: "icalendar",
						document: minimalIcalDocument("test-uid-123"),
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(entityStore.get(entityId)?.logicalUid).toBe("test-uid-123");
	});

	it("sets logicalUid from the document UID when present (vCard)", async () => {
		const uid = crypto.randomUUID();
		const { repo: entityRepo, store: entityStore } = makeTestEntityRepository();
		const { repo: compRepo } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);

		const entityId = await runSuccess(
			DomainEntityService.pipe(
				Effect.flatMap((s) =>
					s.create({
						entityType: "vcard",
						document: minimalVcardDocument(uid),
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(entityStore.get(entityId)?.logicalUid).toBe(`urn:uuid:${uid}`);
	});

	it("leaves logicalUid null when document has no UID", async () => {
		const { repo: entityRepo, store: entityStore } = makeTestEntityRepository();
		const { repo: compRepo } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);

		const entityId = await runSuccess(
			DomainEntityService.pipe(
				Effect.flatMap((s) =>
					s.create({
						entityType: "icalendar",
						document: minimalIcalDocument(),
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(entityStore.get(entityId)?.logicalUid).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

describe("DomainEntityService.load", () => {
	it("returns Some(IrDocument) after create", async () => {
		const { repo: entityRepo } = makeTestEntityRepository();
		const { repo: compRepo } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);
		const doc = minimalIcalDocument("my-uid");

		const result = await runSuccess(
			Effect.gen(function* () {
				const svc = yield* DomainEntityService;
				const entityId = yield* svc.create({
					entityType: "icalendar",
					document: doc,
				});
				return yield* svc.load(entityId);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result).kind).toBe("icalendar");
	});

	it("returns None for an unknown EntityId", async () => {
		const { repo: entityRepo } = makeTestEntityRepository();
		const { repo: compRepo } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);

		const result = await runSuccess(
			DomainEntityService.pipe(
				Effect.flatMap((s) => s.load(EntityId(crypto.randomUUID()))),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(Option.isNone(result)).toBe(true);
	});

	it("returns None if entity exists but component tree is missing (defensive)", async () => {
		const { repo: entityRepo } = makeTestEntityRepository();
		const emptyCompRepo: ComponentRepositoryShape = {
			insertTree: () => Effect.succeed(ComponentId(crypto.randomUUID())),
			loadTree: () => Effect.succeed(Option.none()),
			deleteByEntity: () => Effect.void,
		};
		const layer = makeTestLayer(entityRepo, emptyCompRepo);

		const result = await runSuccess(
			Effect.gen(function* () {
				const svc = yield* DomainEntityService;
				const entityId = yield* svc.create({
					entityType: "icalendar",
					document: minimalIcalDocument(),
				});
				return yield* svc.load(entityId);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isNone(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// replace
// ---------------------------------------------------------------------------

describe("DomainEntityService.replace", () => {
	it("causes load to return the replacement document", async () => {
		const { repo: entityRepo } = makeTestEntityRepository();
		const { repo: compRepo } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);

		const loaded = await runSuccess(
			Effect.gen(function* () {
				const svc = yield* DomainEntityService;
				const entityId = yield* svc.create({
					entityType: "icalendar",
					document: minimalIcalDocument("uid-v1"),
				});
				yield* svc.replace(entityId, minimalIcalDocument("uid-v2"));
				return yield* svc.load(entityId);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const doc = Option.getOrThrow(loaded);
		const uid = doc.root.components[0]?.properties.find(
			(p) => p.name === "UID",
		)?.value;
		expect(uid).toEqual({ type: "TEXT", value: "uid-v2" });
	});

	it("updates logicalUid when the new document UID differs", async () => {
		const { repo: entityRepo, store: entityStore } = makeTestEntityRepository();
		const { repo: compRepo } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);

		const entityId = await runSuccess(
			Effect.gen(function* () {
				const svc = yield* DomainEntityService;
				const id = yield* svc.create({
					entityType: "icalendar",
					document: minimalIcalDocument("uid-original"),
				});
				yield* svc.replace(id, minimalIcalDocument("uid-updated"));
				return id;
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(entityStore.get(entityId)?.logicalUid).toBe("uid-updated");
	});

	it("clears logicalUid to null when the new document has no UID", async () => {
		const { repo: entityRepo, store: entityStore } = makeTestEntityRepository();
		const { repo: compRepo } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);

		const entityId = await runSuccess(
			Effect.gen(function* () {
				const svc = yield* DomainEntityService;
				const id = yield* svc.create({
					entityType: "icalendar",
					document: minimalIcalDocument("uid-to-remove"),
				});
				yield* svc.replace(id, minimalIcalDocument());
				return id;
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(entityStore.get(entityId)?.logicalUid).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe("DomainEntityService.remove", () => {
	it("causes subsequent load to return None", async () => {
		const { repo: entityRepo } = makeTestEntityRepository();
		const { repo: compRepo } = makeTestComponentRepository();
		const layer = makeTestLayer(entityRepo, compRepo);

		const result = await runSuccess(
			Effect.gen(function* () {
				const svc = yield* DomainEntityService;
				const entityId = yield* svc.create({
					entityType: "icalendar",
					document: minimalIcalDocument(),
				});
				yield* svc.remove(entityId);
				return yield* svc.load(entityId);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isNone(result)).toBe(true);
	});
});
