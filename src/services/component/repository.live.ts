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
import { DatabaseClient } from "#src/db/client.ts";
import {
	type DatetimeListItem,
	davComponent,
	davParameter,
	davProperty,
	type EntityType,
} from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import {
	ComponentId,
	type EntityId,
	type UuidString,
} from "#src/domain/ids.ts";
import {
	repoQueryDurationMs,
	trackDuration,
} from "#src/observability/metrics.ts";
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
	// DATE_TIME_LIST: array of wall-clock + nullable zone (floating = NULL zone).
	// The datetimeList customType maps these ⇄ Temporal values.
	readonly valueDatetimeList?: ReadonlyArray<DatetimeListItem> | null;
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
			// The datetimeList customType serializes each ZonedDateTime/PlainDateTime
			// to the composite wire form (wall + nullable zone).
			return { valueDatetimeList: value.value };
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
			// The customType already mapped the composite array back to
			// ZonedDateTime/PlainDateTime items.
			return {
				type: "DATE_TIME_LIST",
				value: row.valueDatetimeList ?? [],
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
// insertComponentEffect — recursive tree walk, one runDbQuery per insert.
//
// Each insert gets its own db.insert span. getActiveDb is cheap (a FiberRef
// read) so calling it per-insert via runDbQuery is fine.
// ---------------------------------------------------------------------------

const insertComponentEffect = (
	entityId: EntityId,
	component: IrComponent,
	parentComponentId: UuidString | null,
	ordinal: number,
): Effect.Effect<UuidString, DatabaseError, DatabaseClient> =>
	Effect.gen(function* () {
		const compRows = yield* runDbQuery((db) =>
			db
				.insert(davComponent)
				.values({ entityId, parentComponentId, name: component.name, ordinal })
				.returning(),
		);
		const compRow = compRows[0];
		if (!compRow) {
			return yield* Effect.fail(
				new DatabaseError({
					cause: new Error("Component insert returned no rows"),
				}),
			);
		}
		const componentId = compRow.id as UuidString;

		for (let i = 0; i < component.properties.length; i++) {
			const prop = component.properties[i];
			if (!prop) {
				continue;
			}
			const valueColumns = irValueToDbColumns(prop.value);
			const propRows = yield* runDbQuery((db) =>
				db
					.insert(davProperty)
					.values({
						componentId,
						name: prop.name,
						valueType: prop.value.type,
						ordinal: i,
						...valueColumns,
					})
					.returning(),
			);
			const propRow = propRows[0];
			if (!propRow) {
				return yield* Effect.fail(
					new DatabaseError({
						cause: new Error("Property insert returned no rows"),
					}),
				);
			}
			const propertyId = propRow.id;

			for (let j = 0; j < prop.parameters.length; j++) {
				const param = prop.parameters[j];
				if (!param) {
					continue;
				}
				yield* runDbQuery((db) =>
					db.insert(davParameter).values({
						propertyId,
						name: param.name,
						value: param.value,
						ordinal: j,
					}),
				).pipe(Effect.asVoid);
			}
		}

		for (let i = 0; i < component.components.length; i++) {
			const child = component.components[i];
			if (!child) {
				continue;
			}
			yield* insertComponentEffect(entityId, child, componentId, i);
		}

		return componentId;
	});

const compDuration = repoQueryDurationMs.pipe(
	Metric.withAttributes({ "repo.entity": "component" }),
);

const insertTree = Effect.fn("ComponentRepository.insertTree")(
	function* (entityId: EntityId, root: IrComponent) {
		yield* Effect.annotateCurrentSpan({ "entity.id": entityId });
		yield* Effect.logTrace("repo.component.insertTree", { entityId });
		return yield* insertComponentEffect(entityId, root, null, 0).pipe(
			Effect.map(ComponentId),
			trackDuration(
				compDuration.pipe(
					Metric.withAttributes({ "repo.operation": "insertTree" }),
				),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.component.insertTree failed", e.cause),
	),
);

// ---------------------------------------------------------------------------
// loadTree — three separate queries then in-memory tree reconstruction
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

// Build the componentId → IrProperty[] map from flat property + parameter rows.
// Component ids and property ids are globally unique, so a single shared index
// works whether the rows came from one entity or many (batch load).
const indexProperties = (
	properties: Array<PropertyRow>,
	parameters: Array<ParameterRow>,
	isKnown: (name: string) => boolean,
): Map<string, Array<IrProperty>> => {
	const paramsByPropId = new Map<string, Array<IrParameter>>();
	for (const param of parameters) {
		const list = paramsByPropId.get(param.propertyId) ?? [];
		list.push({ name: param.name, value: param.value });
		paramsByPropId.set(param.propertyId, list);
	}

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
	return propertiesByCompId;
};

// Load the active parameter rows for a set of property rows (one query, or
// none at all when there are no properties). Shared by loadTree/loadTreesByIds.
const loadParameters = (
	properties: Array<PropertyRow>,
): Effect.Effect<Array<ParameterRow>, DatabaseError, DatabaseClient> =>
	properties.length === 0
		? Effect.succeed<Array<ParameterRow>>([])
		: runDbQuery((db) =>
				db
					.select()
					.from(davParameter)
					.where(
						and(
							inArray(
								davParameter.propertyId,
								properties.map((p) => p.id),
							),
							isNull(davParameter.deletedAt),
						),
					)
					.orderBy(davParameter.ordinal),
			);

// Reconstruct one entity's tree from its component rows plus the shared
// property index. Returns none if the entity has no root component.
const assembleTree = (
	components: Array<ComponentRow>,
	propertiesByCompId: Map<string, Array<IrProperty>>,
): Option.Option<IrComponent> => {
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
		return Option.none<IrComponent>();
	}
	return Option.some(
		buildIrComponent(rootComp, childrenByParentId, propertiesByCompId),
	);
};

const loadTree = Effect.fn("ComponentRepository.loadTree")(
	function* (entityId: EntityId, entityType: EntityType) {
		yield* Effect.annotateCurrentSpan({
			"entity.id": entityId,
			"entity.type": entityType,
		});
		yield* Effect.logTrace("repo.component.loadTree", { entityId, entityType });
		const isKnown =
			entityType === "icalendar" ? isKnownIcalProperty : isKnownVcardProperty;

		// 1. Load all active component rows for the entity
		const components = yield* runDbQuery((db) =>
			db
				.select()
				.from(davComponent)
				.where(
					and(
						eq(davComponent.entityId, entityId),
						isNull(davComponent.deletedAt),
					),
				)
				.orderBy(davComponent.ordinal),
		);

		if (components.length === 0) {
			return Option.none<IrComponent>();
		}

		const componentIds = components.map((c) => c.id);

		// 2. Load all active property rows for those components
		const properties = yield* runDbQuery((db) =>
			db
				.select()
				.from(davProperty)
				.where(
					and(
						inArray(davProperty.componentId, componentIds),
						isNull(davProperty.deletedAt),
					),
				)
				.orderBy(davProperty.ordinal),
		);

		// 3. Load all active parameter rows for those properties
		const parameters = yield* loadParameters(properties);

		// 4. Index properties/parameters and reconstruct the tree
		const propertiesByCompId = indexProperties(properties, parameters, isKnown);
		return assembleTree(components, propertiesByCompId);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.component.loadTree failed", e.cause),
	),
);

// ---------------------------------------------------------------------------
// loadTreesByIds — batch variant: 3 queries total for any number of entities
// ---------------------------------------------------------------------------

const loadTreesByIds = Effect.fn("ComponentRepository.loadTreesByIds")(
	function* (entityIds: ReadonlyArray<EntityId>, entityType: EntityType) {
		yield* Effect.annotateCurrentSpan({
			"entity.count": entityIds.length,
			"entity.type": entityType,
		});
		yield* Effect.logTrace("repo.component.loadTreesByIds", {
			count: entityIds.length,
			entityType,
		});

		const result = new Map<EntityId, IrComponent>();
		if (entityIds.length === 0) {
			return result as ReadonlyMap<EntityId, IrComponent>;
		}

		const isKnown =
			entityType === "icalendar" ? isKnownIcalProperty : isKnownVcardProperty;

		// 1. All active component rows across every requested entity
		const components = yield* runDbQuery((db) =>
			db
				.select()
				.from(davComponent)
				.where(
					and(
						inArray(davComponent.entityId, entityIds as Array<EntityId>),
						isNull(davComponent.deletedAt),
					),
				)
				.orderBy(davComponent.ordinal),
		);
		if (components.length === 0) {
			return result as ReadonlyMap<EntityId, IrComponent>;
		}

		const componentIds = components.map((c) => c.id);

		// 2. All active property rows for those components
		const properties = yield* runDbQuery((db) =>
			db
				.select()
				.from(davProperty)
				.where(
					and(
						inArray(davProperty.componentId, componentIds),
						isNull(davProperty.deletedAt),
					),
				)
				.orderBy(davProperty.ordinal),
		);

		// 3. All active parameter rows for those properties
		const parameters = yield* loadParameters(properties);

		const propertiesByCompId = indexProperties(properties, parameters, isKnown);

		// Partition components by their owning entity, then assemble each tree.
		const componentsByEntity = new Map<string, Array<ComponentRow>>();
		for (const comp of components) {
			const list = componentsByEntity.get(comp.entityId) ?? [];
			list.push(comp);
			componentsByEntity.set(comp.entityId, list);
		}
		for (const [eid, comps] of componentsByEntity) {
			const tree = assembleTree(comps, propertiesByCompId);
			if (Option.isSome(tree)) {
				result.set(eid as EntityId, tree.value);
			}
		}
		return result as ReadonlyMap<EntityId, IrComponent>;
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.component.loadTreesByIds failed", e.cause),
	),
);

// ---------------------------------------------------------------------------
// deleteByEntity — soft-delete all component rows for an entity
// ---------------------------------------------------------------------------

const deleteByEntity = Effect.fn("ComponentRepository.deleteByEntity")(
	function* (entityId: EntityId) {
		yield* Effect.annotateCurrentSpan({ "entity.id": entityId });
		yield* Effect.logTrace("repo.component.deleteByEntity", { entityId });
		return yield* runDbQuery((db) =>
			db
				.update(davComponent)
				.set({ deletedAt: sql`now()` })
				.where(
					and(
						eq(davComponent.entityId, entityId),
						isNull(davComponent.deletedAt),
					),
				),
		).pipe(
			Effect.asVoid,
			trackDuration(
				compDuration.pipe(
					Metric.withAttributes({ "repo.operation": "deleteByEntity" }),
				),
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
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			insertTree: (...args: Parameters<typeof insertTree>) =>
				run(insertTree(...args)),
			loadTree: (...args: Parameters<typeof loadTree>) =>
				run(loadTree(...args)),
			loadTreesByIds: (...args: Parameters<typeof loadTreesByIds>) =>
				run(loadTreesByIds(...args)),
			deleteByEntity: (...args: Parameters<typeof deleteByEntity>) =>
				run(deleteByEntity(...args)),
		};
	}),
);
