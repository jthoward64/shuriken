import type { IrDeadProperties } from "#src/data/ir.ts";

// The `client_properties` jsonb columns come back from Drizzle as unknown JSON,
// so rows are narrowed here rather than asserted at each read site.

/** True when a stored `client_properties` value is a dead-property map */
export const isDeadProperties = (value: unknown): value is IrDeadProperties =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads a stored `client_properties` value, treating anything else as empty */
export const readDeadProperties = (value: unknown): IrDeadProperties =>
	isDeadProperties(value) ? value : {};
