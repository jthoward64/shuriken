import { customType } from "drizzle-orm/pg-core";
import { Temporal } from "temporal-polyfill";

/** TIMESTAMPTZ → Temporal.Instant (absolute point in time) */
export const timestampTz = customType<{
	data: Temporal.Instant;
	driverData: string;
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
	driverData: string;
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
	driverData: string;
}>({
	dataType: () => "date",
	fromDriver(value: string): Temporal.PlainDate {
		return Temporal.PlainDate.from(value);
	},
	toDriver(value: Temporal.PlainDate): string {
		return value.toString();
	},
});

/** tsvector (read-only, generated column) */
export const tsvector = customType<{ data: string }>({
	dataType: () => "tsvector",
});

/** tstzrange → [Temporal.Instant, Temporal.Instant] */
export const tstzrange = customType<{
	data: [Temporal.Instant, Temporal.Instant];
	driverData: string;
}>({
	dataType: () => "tstzrange",
	fromDriver(value: string): [Temporal.Instant, Temporal.Instant] {
		// Format: '["2024-01-01 00:00:00+00","2024-12-31 23:59:59+00")'
		const match = value.match(/^\s*[[(]\s*([^,]+)\s*,\s*([^\])]+)\s*[\])]\s*$/);
		const [, start, end] = match || [];
		if (!start || !end) {
			throw new Error(`Invalid tstzrange format: ${value}`);
		}
		return [
			Temporal.Instant.from(start.trim().replace(" ", "T")),
			Temporal.Instant.from(end.trim().replace(" ", "T")),
		];
	},
	toDriver(value: [Temporal.Instant, Temporal.Instant]): string {
		return `[${value[0].toString()},${value[1].toString()}]`;
	},
});

/** bytea → Buffer */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => "bytea",
});
