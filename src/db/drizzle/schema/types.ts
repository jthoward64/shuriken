import { type SQL, sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";
import { Redacted } from "effect";
import { Temporal } from "temporal-polyfill";
import {
	COMPOSITE_TYPE,
	type DatetimeListItem,
	parseDatetimeArrayValue,
	serializeDatetimeArray,
} from "./datetime-list-codec.ts";

export type { DatetimeListItem } from "./datetime-list-codec.ts";

interface DrizzleEnumConfig<V> {
	sql: SQL<unknown>;
	$type: V;
}
export type GetDrizzleEnumType<C> =
	C extends DrizzleEnumConfig<infer V> ? V : never;

export function drizzleEnum<V>(column: string, values: Array<V>, type: "text") {
	const arrayContent = values.map((v) => `'${v}'::${type}`).join(", ");
	return {
		sql: sql`(${sql.raw(column)} = ANY (ARRAY[${sql.raw(arrayContent)}]))`,
		// biome-ignore lint/style/useNamingConvention: Special property, not a real value
		$type: null as unknown as V,
	} satisfies DrizzleEnumConfig<V>;
}

/** TIMESTAMPTZ → Temporal.Instant (absolute point in time) */
export const timestampTz = customType<{
	data: Temporal.Instant;
	driverData: string | Date;
}>({
	dataType: () => "timestamptz",
	fromDriver(value: Date | string): Temporal.Instant {
		if (typeof value === "string") {
			return Temporal.Instant.from(value);
		}
		return Temporal.Instant.fromEpochMilliseconds(value.getTime());
	},
	toDriver(value: Temporal.Instant): string {
		return value.toString();
	},
});

/** TIMESTAMP (no TZ) → Temporal.PlainDateTime */
export const timestampStr = customType<{
	data: Temporal.PlainDateTime;
	driverData: string | Date;
}>({
	dataType: () => "timestamp",
	fromDriver(value: Date | string): Temporal.PlainDateTime {
		// Driver sends Date with the wall-clock time interpreted as UTC
		return Temporal.PlainDateTime.from(
			typeof value === "string" ? value : value.toISOString().slice(0, -1),
		);
	},
	toDriver(value: Temporal.PlainDateTime): string {
		return value.toString();
	},
});

/** DATE → Temporal.PlainDate */
export const dateStr = customType<{
	data: Temporal.PlainDate;
	driverData: string | Date;
}>({
	dataType: () => "date",
	fromDriver(value: string | Date): Temporal.PlainDate {
		if (typeof value === "string") {
			return Temporal.PlainDate.from(value);
		}
		return Temporal.PlainDate.from(value.toISOString().slice(0, -1));
	},
	toDriver(value: Temporal.PlainDate): string {
		return value.toString();
	},
});

/** tsvector (read-only, generated column) */
export const tsvector = customType<{ data: string }>({
	dataType: () => "tsvector",
});

/** bytea → Buffer */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => "bytea",
});

/**
 * DATE_TIME_LIST → array of the `dav_datetime` composite type (wall + nullable
 * zone). Each item is a ZonedDateTime (zoned) or PlainDateTime (floating).
 *
 * toDriver always emits the `{...}` composite-array literal (accepted by every
 * driver). fromDriver must cope with both shapes drivers return for a composite
 * array: the full `{...}` text (postgres.js, raw PGlite) or a pre-split array of
 * record literals (the @effect/sql clients). See ./datetime-list-codec.ts.
 */
export const datetimeList = customType<{
	data: ReadonlyArray<DatetimeListItem>;
	driverData: string | ReadonlyArray<string>;
}>({
	dataType: () => `${COMPOSITE_TYPE}[]`,
	toDriver: (items) => serializeDatetimeArray(items),
	fromDriver: (value) => parseDatetimeArrayValue(value),
});

/** text → Redacted<string> — prevents sensitive values from appearing in logs */
export const redactedText = customType<{
	data: Redacted.Redacted<string>;
	driverData: string;
}>({
	dataType: () => "text",
	fromDriver: (value) => Redacted.make(value),
	toDriver: (value) => Redacted.value(value),
});
