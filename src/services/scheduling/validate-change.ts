// ---------------------------------------------------------------------------
// validateSchedulingChange - RFC 6638 §3.2.2 / §3.2.4 change restrictions
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { forbidden } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { SchedulingDeps } from "./deps.ts";
import { irEquals } from "./ir-equal.ts";
import {
	extractOrganizerCalAddress,
	isSchedulable,
	isSor,
} from "./itip-extract.ts";
import { determineRole } from "./principal-role.ts";

/** Properties attendees are allowed to modify (RFC 6638 §3.2.2.1) */
const ATTENDEE_MUTABLE_PROPS = new Set([
	"TRANSP",
	"VALARM",
	"DTSTAMP",
	"LAST-MODIFIED",
	"SEQUENCE",
	"ATTENDEE", // PARTSTAT changes are on the ATTENDEE property itself
]);

/** Every distinct ORGANIZER cal-address across a document's schedulable components */
const organizerAddresses = (doc: IrDocument): ReadonlySet<string> =>
	new Set(
		(doc.kind === "icalendar" ? doc.root.components : [])
			.filter(isSchedulable)
			.flatMap((c) => {
				const p = c.properties.find((pp) => pp.name === "ORGANIZER");
				return p?.value.type === "CAL_ADDRESS"
					? [p.value.value.toLowerCase()]
					: [];
			}),
	);

/** RFC 6638 §3.2.4.2: every component must name the same ORGANIZER */
const hasConsistentOrganizer = (
	doc: IrDocument,
	organizerCalAddress: string,
): boolean => {
	const organizers = organizerAddresses(doc);
	if (organizers.size > 1) {
		return false;
	}
	return (
		organizers.size !== 1 || organizers.has(organizerCalAddress.toLowerCase())
	);
};

/** True when the component changes only properties an attendee may modify */
const isAttendeeMutableChange = (
	oldComp: IrComponent,
	newComp: IrComponent,
): boolean =>
	newComp.properties.every((prop) => {
		if (ATTENDEE_MUTABLE_PROPS.has(prop.name)) {
			return true;
		}
		const oldProp = oldComp.properties.find((p) => p.name === prop.name);
		return irEquals(prop.value, oldProp?.value);
	});

/** RFC 6638 §3.2.2.1: an attendee may only touch attendee-mutable properties */
const isAllowedAttendeeChange = (
	oldDoc: IrDocument,
	newDoc: IrDocument,
): boolean => {
	if (oldDoc.kind !== "icalendar" || newDoc.kind !== "icalendar") {
		return true;
	}
	return newDoc.root.components.every((newComp, i) => {
		const oldComp = oldDoc.root.components[i];
		if (!(oldComp && isSchedulable(newComp))) {
			return true;
		}
		return isAttendeeMutableChange(oldComp, newComp);
	});
};

export const validateSchedulingChange = Effect.fn(
	"SchedulingService.validateSchedulingChange",
)(function* (
	deps: SchedulingDeps,
	opts: {
		actingPrincipalId: PrincipalId;
		oldDoc: IrDocument;
		newDoc: IrDocument;
	},
) {
	yield* Effect.annotateCurrentSpan({
		"scheduling.principal_id": opts.actingPrincipalId,
	});
	yield* Effect.logTrace("scheduling.validateSchedulingChange", {
		actingPrincipalId: opts.actingPrincipalId,
	});

	if (!(isSor(opts.oldDoc) || isSor(opts.newDoc))) {
		return;
	}

	const organizerCalAddress =
		extractOrganizerCalAddress(opts.newDoc) ??
		extractOrganizerCalAddress(opts.oldDoc);
	if (!organizerCalAddress) {
		return;
	}

	if (!hasConsistentOrganizer(opts.newDoc, organizerCalAddress)) {
		yield* forbidden("CALDAV:same-organizer-in-all-components");
		return;
	}

	const role = yield* determineRole(
		deps,
		opts.actingPrincipalId,
		organizerCalAddress,
	);
	if (role !== "attendee") {
		return;
	}

	if (!isAllowedAttendeeChange(opts.oldDoc, opts.newDoc)) {
		yield* forbidden("CALDAV:allowed-attendee-scheduling-object-change");
	}
});
