import { Effect, Option } from "effect";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import { normalizeRruleUntil } from "#src/data/icalendar/recurrence/recurrence-check.ts";
import {
	type ResolutionZone,
	UTC,
} from "#src/data/icalendar/resolve-floating.ts";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import type { MailMessage } from "#src/services/mailer/service.ts";

// ---------------------------------------------------------------------------
// iMIP envelope builder (RFC 6047).
//
// The body is a `text/calendar; method=…; charset=utf-8` MIME part whose
// content is a VCALENDAR with a matching METHOD property. Attendees may
// receive the same message but with their personal CN/RSVP — for v1 we send
// the same VCALENDAR to every recipient and let their client present it.
//
// Method semantics in this codebase:
//   REQUEST  — initial invite or any update
//   CANCEL   — event deleted, or an attendee was removed and we want to
//              drop the meeting from their calendar
//   REPLY    — attendee accepted/declined (inbound from remote attendees;
//              we don't send REPLY ourselves yet)
// ---------------------------------------------------------------------------

export type ImipMethod = "REQUEST" | "CANCEL" | "REPLY";

export interface ImipBuildInput {
	readonly method: ImipMethod;
	readonly vevent: IrComponent;
	readonly to: ReadonlyArray<string>;
	readonly subjectPrefix?: string;
	/**
	 * Zone the organizer's floating times are anchored to before sending.
	 *
	 * A floating DTSTART means "the same clock time wherever you are", which is
	 * right for a private calendar and wrong for an invitation: the recipient's
	 * client would read 09:00 as 09:00 in *their* zone. Anchoring to the
	 * organizing calendar's zone is what makes the invite name one instant.
	 */
	readonly zone?: ResolutionZone;
	/** VTIMEZONE text for `zone`, included when any value was anchored to it. */
	readonly vtimezone?: IrComponent | null;
}

// Date-bearing properties whose floating values name the meeting's time. TZID
// is only valid on DATE-TIME values (RFC 5545 section 3.2.19), so DATE-valued
// all-day properties are deliberately left untouched.
const ANCHORED_PROPS = new Set([
	"DTSTART",
	"DTEND",
	"DUE",
	"RECURRENCE-ID",
	"EXDATE",
	"RDATE",
]);

// A UTC value encodes with a trailing `Z` and is self-describing, so it takes
// no TZID parameter (RFC 5545 section 3.3.5 form 2)
const withTzidParam = (
	prop: IrProperty,
	zone: ResolutionZone,
): ReadonlyArray<{ name: string; value: string }> =>
	zone === UTC || prop.parameters.some((p) => p.name.toUpperCase() === "TZID")
		? prop.parameters
		: [...prop.parameters, { name: "TZID", value: zone }];

/**
 * Rewrite a floating value to the same wall time in `zone`.
 *
 * Returns the property unchanged when it carries nothing floating, so a value
 * the organizer already pinned to a zone or to UTC is never rewritten.
 */
const anchorProperty = (
	prop: IrProperty,
	zone: ResolutionZone,
): { prop: IrProperty; anchored: boolean } => {
	if (!ANCHORED_PROPS.has(prop.name)) {
		return { prop, anchored: false };
	}
	if (prop.value.type === "PLAIN_DATE_TIME") {
		return {
			prop: {
				...prop,
				parameters: [...withTzidParam(prop, zone)],
				value: {
					type: "DATE_TIME",
					value: prop.value.value.toZonedDateTime(zone),
				},
			},
			anchored: true,
		};
	}
	if (prop.value.type === "DATE_TIME_LIST") {
		const items = prop.value.value;
		if (!items.some((dt) => !("timeZoneId" in dt))) {
			return { prop, anchored: false };
		}
		return {
			prop: {
				...prop,
				parameters: [...withTzidParam(prop, zone)],
				value: {
					type: "DATE_TIME_LIST",
					value: items.map((dt) =>
						"timeZoneId" in dt ? dt : dt.toZonedDateTime(zone),
					),
				},
			},
			anchored: true,
		};
	}
	return { prop, anchored: false };
};

/**
 * Anchor every floating value in a component (and its VALARMs) to `zone`.
 * Reports whether anything was anchored so the caller only attaches a
 * VTIMEZONE that is actually referenced.
 */
/**
 * Rewrite a floating RRULE UNTIL to UTC.
 *
 * RFC 5545 section 3.3.10: UNTIL must match DTSTART's form, so a floating UNTIL
 * is only correct while DTSTART is floating too. Anchoring DTSTART turns it into
 * a date with a time zone reference, at which point UNTIL MUST become a date
 * with UTC time - otherwise the invitation carries a recurrence rule the
 * recipient may reject or mis-bound.
 *
 * `normalizeRruleUntil` reads a naive UNTIL in `zone` (the same zone DTSTART was
 * just anchored to) and emits it with a trailing `Z`; an UNTIL that is already
 * UTC or date-only is left alone.
 */
const anchorRruleUntil = (
	prop: IrProperty,
	zone: ResolutionZone,
): IrProperty => {
	if (prop.name !== "RRULE" || prop.value.type !== "RECUR") {
		return prop;
	}
	const normalized = normalizeRruleUntil(prop.value.value, zone);
	return normalized === prop.value.value
		? prop
		: { ...prop, value: { type: "RECUR", value: normalized } };
};

const anchorComponent = (
	comp: IrComponent,
	zone: ResolutionZone,
): { component: IrComponent; anchored: boolean } => {
	let anchored = false;
	// Tracked per component: an UNTIL belongs to the same component as the
	// DTSTART whose form it has to match
	let dtstartAnchored = false;
	const anchoredProps = comp.properties.map((p) => {
		const result = anchorProperty(p, zone);
		anchored = anchored || result.anchored;
		dtstartAnchored =
			dtstartAnchored || (result.anchored && p.name === "DTSTART");
		return result.prop;
	});
	const properties = dtstartAnchored
		? anchoredProps.map((p) => anchorRruleUntil(p, zone))
		: anchoredProps;
	const components = comp.components.map((child) => {
		const result = anchorComponent(child, zone);
		anchored = anchored || result.anchored;
		return result.component;
	});
	return { component: { ...comp, properties, components }, anchored };
};

const wrapInVcalendarWithMethod = (
	method: ImipMethod,
	vevent: IrComponent,
	vtimezone: IrComponent | null,
): IrDocument => {
	const props: Array<IrProperty> = [
		{
			name: "VERSION",
			parameters: [],
			value: { type: "TEXT", value: "2.0" },
			isKnown: true,
		},
		{
			name: "PRODID",
			parameters: [],
			value: { type: "TEXT", value: "-//shuriken//imip//EN" },
			isKnown: true,
		},
		{
			name: "METHOD",
			parameters: [],
			value: { type: "TEXT", value: method },
			isKnown: true,
		},
	];
	return {
		kind: "icalendar",
		root: {
			name: "VCALENDAR",
			properties: props,
			// VTIMEZONE first so a client reading in order resolves the TZID
			// references before it meets them
			components: vtimezone === null ? [vevent] : [vtimezone, vevent],
		},
	};
};

const summaryOf = (vevent: IrComponent): string => {
	const summary = vevent.properties.find((p) => p.name === "SUMMARY");
	if (summary && summary.value.type === "TEXT") {
		return summary.value.value;
	}
	return "(no title)";
};

const subjectFor = (input: ImipBuildInput): string => {
	const summary = summaryOf(input.vevent);
	const prefix =
		input.subjectPrefix ??
		(input.method === "CANCEL"
			? "Cancelled: "
			: input.method === "REPLY"
				? "Re: "
				: "Invitation: ");
	return `${prefix}${summary}`;
};

export const buildImipMessage = (
	input: ImipBuildInput,
): Effect.Effect<MailMessage, never> =>
	Effect.gen(function* () {
		// Always anchor: a floating value left as-is would be read as the
		// recipient's own local time. Falling back to UTC still names one
		// instant, and needs no VTIMEZONE because `Z` is self-describing.
		const zone = input.zone ?? UTC;
		const { component, anchored } = anchorComponent(input.vevent, zone);
		const doc = wrapInVcalendarWithMethod(
			input.method,
			component,
			anchored && zone !== UTC ? (input.vtimezone ?? null) : null,
		);
		const body = yield* encodeICalendar(doc);
		const message: MailMessage = {
			to: input.to,
			subject: subjectFor(input),
			text: body,
			contentType: `text/calendar; method=${input.method}; charset=utf-8`,
		};
		return message;
	});

// Extract attendee email addresses from a VEVENT (CAL-ADDRESS / mailto: …).
export const extractAttendeeAddresses = (
	vevent: IrComponent,
): ReadonlyArray<string> => {
	const out: Array<string> = [];
	for (const p of vevent.properties) {
		if (p.name !== "ATTENDEE") {
			continue;
		}
		// CAL-ADDRESS values are stored as URI by the codec; some inputs land as
		// TEXT for non-mailto schemes — handle both.
		const raw =
			p.value.type === "URI" || p.value.type === "TEXT"
				? p.value.value
				: p.value.type === "CAL_ADDRESS"
					? p.value.value
					: "";
		if (raw === "") {
			continue;
		}
		const lower = raw.toLowerCase();
		const stripped = lower.startsWith("mailto:")
			? raw.slice("mailto:".length)
			: raw;
		out.push(stripped);
	}
	return out;
};

// Extract the ORGANIZER address from a VEVENT (CAL-ADDRESS / mailto: …),
// normalized to lowercase with any "mailto:" prefix stripped.
export const extractOrganizerAddress = (
	vevent: IrComponent,
): Option.Option<string> => {
	const p = vevent.properties.find((pp) => pp.name === "ORGANIZER");
	const raw =
		p?.value.type === "URI" ||
		p?.value.type === "TEXT" ||
		p?.value.type === "CAL_ADDRESS"
			? p.value.value
			: "";
	if (raw === "") {
		return Option.none();
	}
	const lower = raw.toLowerCase();
	return Option.some(
		lower.startsWith("mailto:") ? lower.slice("mailto:".length) : lower,
	);
};

// True iff `address` looks like one of `localDomains`.
export const isLocalAddress = (
	address: string,
	localDomains: ReadonlyArray<string>,
): boolean => {
	const at = address.lastIndexOf("@");
	if (at < 0) {
		return false;
	}
	const domain = address.slice(at + 1).toLowerCase();
	return localDomains.some((d) => d.toLowerCase() === domain);
};
