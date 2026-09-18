// ---------------------------------------------------------------------------
// Shared helpers for working with IrComponent / IrProperty values.
// Used by both the CalDAV filter evaluator and the recurrence-check module.
//
// Every helper that produces an Instant takes a ResolutionZone, because a
// floating date-time and a DATE both name local wall time and only become an
// instant once a zone is chosen. RFC 4791 section 7.3 makes that choice the
// caller's, so it is a required parameter rather than a default.
// ---------------------------------------------------------------------------

import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import {
	type ResolutionZone,
	resolveFloatingDate,
	resolveFloatingDateTime,
} from "./resolve-floating.ts";

/** Retrieve the DTSTART property from a component, or undefined if absent. */
export const getDtstartProp = (comp: IrComponent): IrProperty | undefined =>
	comp.properties.find((p) => p.name === "DTSTART");

/** Retrieve the DTEND (or DUE for VTODO) property, or undefined if absent. */
export const getDtendProp = (comp: IrComponent): IrProperty | undefined =>
	comp.properties.find((p) => p.name === "DTEND") ??
	comp.properties.find((p) => p.name === "DUE");

/**
 * Convert a date or date-time property value to an Instant.
 *
 * - DATE_TIME (ZonedDateTime) → exact instant, `zone` unused
 * - PLAIN_DATE_TIME (floating) → that wall time in `zone`
 * - DATE (all-day) → start of that day in `zone`
 * - anything else → undefined
 */
export const instantFromIrValue = (
	prop: IrProperty,
	zone: ResolutionZone,
): Temporal.Instant | undefined => {
	const v = prop.value;
	if (v.type === "DATE_TIME") {
		return v.value.toInstant();
	}
	if (v.type === "PLAIN_DATE_TIME") {
		return resolveFloatingDateTime(v.value, zone);
	}
	if (v.type === "DATE") {
		return resolveFloatingDate(v.value, zone);
	}
	return undefined;
};

/** Instant for DTSTART, or undefined when absent / not a date value. */
export const getDtstartInstant = (
	comp: IrComponent,
	zone: ResolutionZone,
): Temporal.Instant | undefined => {
	const prop = getDtstartProp(comp);
	return prop ? instantFromIrValue(prop, zone) : undefined;
};

/** Instant for DTEND/DUE, or undefined when absent / not a date value. */
export const getDtendInstant = (
	comp: IrComponent,
	zone: ResolutionZone,
): Temporal.Instant | undefined => {
	const prop = getDtendProp(comp);
	return prop ? instantFromIrValue(prop, zone) : undefined;
};

/**
 * Effective DTEND per RFC 4791 section 9.9:
 *   - DTEND/DUE if present
 *   - else DTSTART + DURATION if DURATION is present
 *   - else one day for a DATE-valued DTSTART (RFC 5545 section 3.6.1)
 *   - else DTSTART (zero-duration / instant)
 */
export const effectiveDtend = (
	comp: IrComponent,
	dtstart: Temporal.Instant,
	zone: ResolutionZone,
): Temporal.Instant => {
	const explicit = getDtendInstant(comp, zone);
	if (explicit) {
		return explicit;
	}
	const durationProp = comp.properties.find((p) => p.name === "DURATION");
	if (durationProp && durationProp.value.type === "DURATION") {
		try {
			// Nominal units (days and up) are counted on the zone's calendar, so a
			// P1D event spanning a DST change stays one wall-clock day
			return dtstart
				.toZonedDateTimeISO(zone)
				.add(Temporal.Duration.from(durationProp.value.value))
				.toInstant();
		} catch {
			// Ambiguous or invalid duration (e.g. months) — fall through
		}
	}
	// RFC 5545 section 3.6.1: a DATE-valued DTSTART with neither DTEND nor
	// DURATION lasts one day, and RFC 4791 section 9.9's VEVENT table matches it
	// as `start < DTSTART+P1D`. Treating it as an instant instead would hide an
	// all-day event from any query whose window opens at or after its midnight,
	// including a query for its own day. Counted on the zone's calendar so a day
	// carrying a DST change is still one day.
	if (getDtstartProp(comp)?.value.type === "DATE") {
		return dtstart.toZonedDateTimeISO(zone).add({ days: 1 }).toInstant();
	}
	return dtstart;
};
