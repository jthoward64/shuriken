import { Effect, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { IrComponent, IrDocument } from "../ir.ts";
import { encodeICalComponent } from "./codec.ts";

// ---------------------------------------------------------------------------
// VtimezoneExtract — data extracted from a VTIMEZONE component for cal_timezone
// ---------------------------------------------------------------------------

export interface VtimezoneExtract {
	readonly tzid: string;
	/** Full serialized text of the VTIMEZONE component (BEGIN:VTIMEZONE…END:VTIMEZONE). */
	readonly vtimezoneData: string;
	/** IANA timezone name, derived from the X-LIC-LOCATION property when present. */
	readonly ianaName: Option.Option<string>;
	/** VTIMEZONE LAST-MODIFIED value per RFC 5545 §3.6.5, used for conflict resolution. */
	readonly lastModified: Option.Option<Temporal.Instant>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the value of a TEXT property by name, or undefined if absent/wrong type. */
const getTextProp = (
	component: IrComponent,
	name: string,
): string | undefined => {
	const prop = component.properties.find((p) => p.name === name);
	if (prop === undefined || prop.value.type !== "TEXT") {
		return undefined;
	}
	return prop.value.value;
};

/** Extract LAST-MODIFIED as a Temporal.Instant from a VTIMEZONE component. */
const getLastModified = (
	component: IrComponent,
): Option.Option<Temporal.Instant> => {
	const prop = component.properties.find((p) => p.name === "LAST-MODIFIED");
	if (prop === undefined || prop.value.type !== "DATE_TIME") {
		return Option.none();
	}
	return Option.some(prop.value.value.toInstant());
};

// ---------------------------------------------------------------------------
// extractVtimezones
// ---------------------------------------------------------------------------

/**
 * Extract all VTIMEZONE component data from a parsed iCalendar document.
 *
 * Returns an empty array when:
 * - the document is not iCalendar (e.g. vCard)
 * - the VCALENDAR has no VTIMEZONE sub-components
 *
 * VTIMEZONE components that are missing the mandatory TZID property
 * (RFC 5545 §3.6.5) are silently skipped.
 *
 * Each result contains the TZID, the full serialized VTIMEZONE text
 * (for storage in cal_timezone), the IANA name when derivable from
 * X-LIC-LOCATION, and the LAST-MODIFIED instant for conflict resolution.
 */
export const extractVtimezones = (
	doc: IrDocument,
): Effect.Effect<ReadonlyArray<VtimezoneExtract>, never> => {
	if (doc.kind !== "icalendar") {
		return Effect.succeed([]);
	}

	// Pair each VTIMEZONE with its TZID value; skip components missing TZID.
	const candidates = doc.root.components.flatMap(
		(component): Array<{ component: IrComponent; tzid: string }> => {
			if (component.name !== "VTIMEZONE") {
				return [];
			}
			const tzid = getTextProp(component, "TZID");
			if (tzid === undefined) {
				return [];
			}
			return [{ component, tzid }];
		},
	);

	return Effect.forEach(candidates, ({ component, tzid }) =>
		encodeICalComponent(component).pipe(
			Effect.map(
				(vtimezoneData): VtimezoneExtract => ({
					tzid,
					vtimezoneData,
					ianaName: Option.fromNullable(
						getTextProp(component, "X-LIC-LOCATION") ?? null,
					),
					lastModified: getLastModified(component),
				}),
			),
		),
	);
};
