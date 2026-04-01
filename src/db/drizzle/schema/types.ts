import { customType } from "drizzle-orm/pg-core";
import { Redacted } from "effect";
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

/** bytea → Buffer */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => "bytea",
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
