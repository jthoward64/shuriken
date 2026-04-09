// ---------------------------------------------------------------------------
// Shared helpers for working with IrComponent / IrProperty values.
// Used by both the CalDAV filter evaluator and the recurrence-check module.
// ---------------------------------------------------------------------------

import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";

/** Retrieve the DTSTART property from a component, or undefined if absent. */
export const getDtstartProp = (comp: IrComponent): IrProperty | undefined =>
	comp.properties.find((p) => p.name === "DTSTART");

/** Retrieve the DTEND (or DUE for VTODO) property, or undefined if absent. */
export const getDtendProp = (comp: IrComponent): IrProperty | undefined =>
	comp.properties.find((p) => p.name === "DTEND") ??
	comp.properties.find((p) => p.name === "DUE");

/**
 * Convert a DATE_TIME or DATE property value to a UTC Instant.
 *
 * - DATE_TIME (ZonedDateTime) → exact instant
 * - DATE (PlainDate, all-day) → UTC midnight of that date
 * - PLAIN_DATE_TIME (floating) → undefined (no timezone context)
 */
export const instantFromIrValue = (
	prop: IrProperty,
): Temporal.Instant | undefined => {
	const v = prop.value;
	if (v.type === "DATE_TIME") {
		return v.value.toInstant();
	}
	if (v.type === "DATE") {
		return Temporal.Instant.from(`${v.value.toString()}T00:00:00Z`);
	}
	return undefined;
};

/** UTC Instant for DTSTART, or undefined when absent / floating. */
export const getDtstartInstant = (
	comp: IrComponent,
): Temporal.Instant | undefined => {
	const prop = getDtstartProp(comp);
	return prop ? instantFromIrValue(prop) : undefined;
};

/** UTC Instant for DTEND/DUE, or undefined when absent / floating. */
export const getDtendInstant = (
	comp: IrComponent,
): Temporal.Instant | undefined => {
	const prop = getDtendProp(comp);
	return prop ? instantFromIrValue(prop) : undefined;
};
