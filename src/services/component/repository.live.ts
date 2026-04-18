import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Metric, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { isKnownIcalProperty } from "#src/data/icalendar/known.ts";
import type {
	IrComponent,
	IrParameter,
	IrProperty,
	IrValue,
} from "#src/data/ir.ts";
import { isKnownVcardProperty } from "#src/data/vcard/known.ts";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import {
	davComponent,
	davParameter,
	davProperty,
	type EntityType,
} from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import {
	ComponentId,
	type EntityId,
	type UuidString,
} from "#src/domain/ids.ts";
import { repoQueryDurationMs } from "#src/observability/metrics.ts";
import { ComponentRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Type aliases for row types
// ---------------------------------------------------------------------------

type ComponentRow = InferSelectModel<typeof davComponent>;
type PropertyRow = InferSelectModel<typeof davProperty>;
type ParameterRow = InferSelectModel<typeof davParameter>;

// ---------------------------------------------------------------------------
// irValueToDbColumns — maps an IrValue to the single DB value column to set.
// All other value columns remain unset (undefined = omitted from insert).
// ---------------------------------------------------------------------------

interface PropertyValueColumns {
	readonly valueText?: string | null;
	readonly valueInt?: number | null;
	readonly valueFloat?: number | null;
	readonly valueBool?: boolean | null;
	readonly valueDate?: Temporal.PlainDate | null;
	readonly valueTstz?: Temporal.Instant | null;
	readonly valuePlainDatetime?: Temporal.PlainDateTime | null;
	readonly valueBytes?: Buffer | null;
	readonly valueJson?: unknown;
	readonly valueTextArray?: Array<string> | null;
	readonly valueDateArray?: Array<Temporal.PlainDate> | null;
	readonly valueTstzArray?: Array<Temporal.Instant> | null;
	readonly valueInterval?: string | null;
}

const irValueToDbColumns = (value: IrValue): PropertyValueColumns => {
	switch (value.type) {
		case "TEXT":
		case "DURATION":
		case "URI":
		case "UTC_OFFSET":
		case "TIME":
		case "DATE_AND_OR_TIME":
		case "RECUR":
		case "CAL_ADDRESS":
		case "PERIOD":
			return { valueText: value.value };
		case "INTEGER":
			return { valueInt: value.value };
		case "FLOAT":
			return { valueFloat: value.value };
		case "BOOLEAN":
			return { valueBool: value.value };
		case "DATE":
			return { valueDate: value.value };
		case "DATE_TIME":
			return { valueTstz: value.value.toInstant() };
		case "PLAIN_DATE_TIME":
			return { valuePlainDatetime: value.value };
		case "BINARY":
			return { valueBytes: Buffer.from(value.value) };
		case "JSON":
			return { valueJson: value.value };
		case "TEXT_LIST":
		case "PERIOD_LIST":
			return { valueTextArray: value.value as Array<string> };
		case "DATE_LIST":
			return { valueDateArray: value.value as Array<Temporal.PlainDate> };
		case "DATE_TIME_LIST":
			return { valueTstzArray: value.value.map((z) => z.toInstant()) };
		case "DURATION_INTERVAL":
		case "UTC_OFFSET_INTERVAL":
			return { valueInterval: value.value };
	}
};

// ---------------------------------------------------------------------------
// dbColumnsToIrValue — reconstructs an IrValue from a loaded property row.
// For DATE_TIME / DATE_TIME_LIST, the TZID parameter value is used to
// reconstruct the correct ZonedDateTime timezone.
// ---------------------------------------------------------------------------

const dbColumnsToIrValue = (
	row: PropertyRow,
	parameters: ReadonlyArray<IrParameter>,
): IrValue => {
	const tzid = parameters.find((p) => p.name === "TZID")?.value;

	switch (row.valueType) {
		case "TEXT":
			return { type: "TEXT", value: row.valueText ?? "" };
		case "DURATION":
			return { type: "DURATION", value: row.valueText ?? "" };
		case "URI":
			return { type: "URI", value: row.valueText ?? "" };
		case "UTC_OFFSET":
			return { type: "UTC_OFFSET", value: row.valueText ?? "" };
		case "TIME":
			return { type: "TIME", value: row.valueText ?? "" };
		case "DATE_AND_OR_TIME":
			return { type: "DATE_AND_OR_TIME", value: row.valueText ?? "" };
		case "RECUR":
			return { type: "RECUR", value: row.valueText ?? "" };
		case "CAL_ADDRESS":
			return { type: "CAL_ADDRESS", value: row.valueText ?? "" };
		case "PERIOD":
			return { type: "PERIOD", value: row.valueText ?? "" };
		case "INTEGER":
			return { type: "INTEGER", value: row.valueInt ?? 0 };
		case "FLOAT":
			return { type: "FLOAT", value: row.valueFloat ?? 0 };
		case "BOOLEAN":
			return { type: "BOOLEAN", value: row.valueBool ?? false };
		case "DATE": {
			if (!row.valueDate) {
				throw new Error("DATE property missing valueDate");
			}
			return { type: "DATE", value: row.valueDate };
		}
		case "DATE_TIME": {
			if (!row.valueTstz) {
				throw new Error("DATE_TIME property missing valueTstz");
			}
			return {
				type: "DATE_TIME",
				value: row.valueTstz.toZonedDateTimeISO(tzid ?? "UTC"),
			};
		}
		case "PLAIN_DATE_TIME": {
			if (!row.valuePlainDatetime) {
				throw new Error("PLAIN_DATE_TIME property missing valuePlainDatetime");
			}
			return { type: "PLAIN_DATE_TIME", value: row.valuePlainDatetime };
		}
		case "BINARY": {
			if (!row.valueBytes) {
				throw new Error("BINARY property missing valueBytes");
			}
			return {
				type: "BINARY",
				value: new Uint8Array(
					row.valueBytes,
				).slice() as Uint8Array<ArrayBuffer>,
			};
		}
		case "JSON":
			return { type: "JSON", value: row.valueJson };
		case "TEXT_LIST":
			return { type: "TEXT_LIST", value: row.valueTextArray ?? [] };
		case "PERIOD_LIST":
			return { type: "PERIOD_LIST", value: row.valueTextArray ?? [] };
		case "DATE_LIST":
			return { type: "DATE_LIST", value: row.valueDateArray ?? [] };
		case "DATE_TIME_LIST":
			return {
				type: "DATE_TIME_LIST",
				value: (row.valueTstzArray ?? []).map((i) =>
					i.toZonedDateTimeISO(tzid ?? "UTC"),
				),
			};
		case "DURATION_INTERVAL":
			return { type: "DURATION_INTERVAL", value: row.valueInterval ?? "" };
		case "UTC_OFFSET_INTERVAL":
			return { type: "UTC_OFFSET_INTERVAL", value: row.valueInterval ?? "" };
		default:
			throw new Error(`Unknown valueType: ${row.valueType}`);
	}
};

// ---------------------------------------------------------------------------
// insertTree — recursive tree walk inside a single Drizzle transaction
// ---------------------------------------------------------------------------

type DrizzleTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

const insertComponentInTx = async (
	tx: DrizzleTx,
	entityId: EntityId,
	component: IrComponent,
	parentComponentId: UuidString | null,
	ordinal: number,
): Promise<UuidString> => {
	const compRows = await tx
		.insert(davComponent)
		.values({ entityId, parentComponentId, name: component.name, ordinal })
		.returning();
	const compRow = compRows[0];
	if (!compRow) {
		throw new Error("Component insert returned no rows");
	}
	const componentId = compRow.id;

	for (let i = 0; i < component.properties.length; i++) {
		const prop = component.properties[i];
		if (!prop) {
			continue;
		}
		const valueColumns = irValueToDbColumns(prop.value);
		const propRows = await tx
			.insert(davProperty)
			.values({
				componentId,
				name: prop.name,
				valueType: prop.value.type,
				ordinal: i,
				...valueColumns,
			})
			.returning();
		const propRow = propRows[0];
		if (!propRow) {
			throw new Error("Property insert returned no rows");
		}
		const propertyId = propRow.id;

		for (let j = 0; j < prop.parameters.length; j++) {
			const param = prop.parameters[j];
			if (!param) {
				continue;
			}
			await tx.insert(davParameter).values({
				propertyId,
				name: param.name,
				value: param.value,
				ordinal: j,
			});
		}
	}

	for (let i = 0; i < component.components.length; i++) {
		const child = component.components[i];
		if (!child) {
			continue;
		}
		await insertComponentInTx(tx, entityId, child, componentId, i);
	}

	return componentId;
};

const compDuration = repoQueryDurationMs.pipe(
	Metric.tagged("repo.entity", "component"),
);

const insertTree = Effect.fn("ComponentRepository.insertTree")(
	function* (db: DbClient, entityId: EntityId, root: IrComponent) {
		yield* Effect.annotateCurrentSpan({ "entity.id": entityId });
		yield* Effect.logTrace("repo.component.insertTree", { entityId });
		return yield* Effect.tryPromise({
			try: () =>
				db.transaction(async (tx) => {
					const rootId = await insertComponentInTx(tx, entityId, root, null, 0);
					return ComponentId(rootId);
				}),
			catch: (e) => new DatabaseError({ cause: e }),
		}).pipe(
			Metric.trackDuration(
				compDuration.pipe(Metric.tagged("repo.operation", "insertTree")),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.component.insertTree failed", e.cause),
	),
);

// ---------------------------------------------------------------------------
// loadTree — bulk load + tree reconstruction
// ---------------------------------------------------------------------------

const buildIrComponent = (
	compRow: ComponentRow,
	childrenByParentId: Map<string, Array<ComponentRow>>,
	propertiesByCompId: Map<string, Array<IrProperty>>,
): IrComponent => {
	const properties = propertiesByCompId.get(compRow.id) ?? [];
	const children = (childrenByParentId.get(compRow.id) ?? []).map((child) =>
		buildIrComponent(child, childrenByParentId, propertiesByCompId),
	);
	return { name: compRow.name, properties, components: children };
};

const loadTree = Effect.fn("ComponentRepository.loadTree")(
	function* (db: DbClient, entityId: EntityId, entityType: EntityType) {
		yield* Effect.annotateCurrentSpan({
			"entity.id": entityId,
			"entity.type": entityType,
		});
		yield* Effect.logTrace("repo.component.loadTree", { entityId, entityType });
		return yield* Effect.tryPromise({
			try: async (): Promise<Option.Option<IrComponent>> => {
			const isKnown =
				entityType === "icalendar" ? isKnownIcalProperty : isKnownVcardProperty;

			// 1. Load all active component rows for the entity
			const components = await db
				.select()
				.from(davComponent)
				.where(
					and(
						eq(davComponent.entityId, entityId),
						isNull(davComponent.deletedAt),
					),
				)
				.orderBy(davComponent.ordinal);

			if (components.length === 0) {
				return Option.none();
			}

			const componentIds = components.map((c) => c.id);

			// 2. Load all active property rows for those components
			const properties = await db
				.select()
				.from(davProperty)
				.where(
					and(
						inArray(davProperty.componentId, componentIds),
						isNull(davProperty.deletedAt),
					),
				)
				.orderBy(davProperty.ordinal);

			// 3. Load all active parameter rows for those properties
			let parameters: Array<ParameterRow> = [];
			if (properties.length > 0) {
				const propertyIds = properties.map((p) => p.id);
				parameters = await db
					.select()
					.from(davParameter)
					.where(
						and(
							inArray(davParameter.propertyId, propertyIds),
							isNull(davParameter.deletedAt),
						),
					)
					.orderBy(davParameter.ordinal);
			}

			// 4. Group parameters by propertyId
			const paramsByPropId = new Map<string, Array<IrParameter>>();
			for (const param of parameters) {
				const list = paramsByPropId.get(param.propertyId) ?? [];
				list.push({ name: param.name, value: param.value });
				paramsByPropId.set(param.propertyId, list);
			}

			// 5. Build IrProperty list per componentId
			const propertiesByCompId = new Map<string, Array<IrProperty>>();
			for (const propRow of properties) {
				const irParams = paramsByPropId.get(propRow.id) ?? [];
				const irProp: IrProperty = {
					name: propRow.name,
					parameters: irParams,
					value: dbColumnsToIrValue(propRow, irParams),
					isKnown: isKnown(propRow.name),
				};
				const list = propertiesByCompId.get(propRow.componentId) ?? [];
				list.push(irProp);
				propertiesByCompId.set(propRow.componentId, list);
			}

			// 6. Build parent→children map and find root
			const childrenByParentId = new Map<string, Array<ComponentRow>>();
			let rootComp: ComponentRow | undefined;
			for (const comp of components) {
				if (comp.parentComponentId === null) {
					rootComp = comp;
				} else {
					const list = childrenByParentId.get(comp.parentComponentId) ?? [];
					list.push(comp);
					childrenByParentId.set(comp.parentComponentId, list);
				}
			}

			if (!rootComp) {
				return Option.none();
			}

			return Option.some(
				buildIrComponent(rootComp, childrenByParentId, propertiesByCompId),
			);
		},
		catch: (e) => new DatabaseError({ cause: e }),
	}).pipe(
		Metric.trackDuration(
			compDuration.pipe(Metric.tagged("repo.operation", "loadTree")),
		),
	);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.component.loadTree failed", e.cause),
	),
);

// ---------------------------------------------------------------------------
// deleteByEntity — soft-delete all component rows for an entity
// ---------------------------------------------------------------------------

const deleteByEntity = Effect.fn("ComponentRepository.deleteByEntity")(
	function* (db: DbClient, entityId: EntityId) {
		yield* Effect.annotateCurrentSpan({ "entity.id": entityId });
		yield* Effect.logTrace("repo.component.deleteByEntity", { entityId });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(davComponent)
					.set({ deletedAt: sql`now()` })
					.where(
						and(
							eq(davComponent.entityId, entityId),
							isNull(davComponent.deletedAt),
						),
					)
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		}).pipe(
			Metric.trackDuration(
				compDuration.pipe(Metric.tagged("repo.operation", "deleteByEntity")),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.component.deleteByEntity failed", e.cause),
	),
);

// ---------------------------------------------------------------------------
// ComponentRepositoryLive
// ---------------------------------------------------------------------------

export const ComponentRepositoryLive = Layer.effect(
	ComponentRepository,
	Effect.map(DatabaseClient, (db) =>
		ComponentRepository.of({
			insertTree: (entityId, root) => insertTree(db, entityId, root),
			loadTree: (entityId, entityType) => loadTree(db, entityId, entityType),
			deleteByEntity: (entityId) => deleteByEntity(db, entityId),
		}),
	),
);
