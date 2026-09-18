// ---------------------------------------------------------------------------
// Pure extraction helpers for iTIP / scheduling object resources (RFC 6638)
// ---------------------------------------------------------------------------

import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import type { AttendeeInfo } from "./types.ts";

/** The component kinds that can carry scheduling information (RFC 6638 §3.1) */
const isSchedulable = (comp: IrComponent): boolean =>
	comp.name === "VEVENT" || comp.name === "VTODO";

/** Every VEVENT/VTODO in an iCalendar document; empty for any other document kind */
const schedulableComponents = (doc: IrDocument): ReadonlyArray<IrComponent> =>
	doc.kind === "icalendar" ? doc.root.components.filter(isSchedulable) : [];

/** True when the document is a scheduling object resource (ORGANIZER + ATTENDEE) */
export const isSor = (doc: IrDocument): boolean =>
	schedulableComponents(doc).some(
		(comp) =>
			comp.properties.some((p) => p.name === "ORGANIZER") &&
			comp.properties.some((p) => p.name === "ATTENDEE"),
	);

/** The first ORGANIZER cal-address in the document, if any */
export const extractOrganizerCalAddress = (
	doc: IrDocument,
): string | undefined => {
	for (const comp of schedulableComponents(doc)) {
		const prop = comp.properties.find((p) => p.name === "ORGANIZER");
		if (prop?.value.type === "CAL_ADDRESS") {
			return prop.value.value;
		}
	}
	return undefined;
};

/** The first UID in the document, if any */
export const extractSorUid = (doc: IrDocument): string | undefined => {
	for (const comp of schedulableComponents(doc)) {
		const prop = comp.properties.find((p) => p.name === "UID");
		if (prop?.value.type === "TEXT") {
			return prop.value.value;
		}
	}
	return undefined;
};

/** Read SCHEDULE-AGENT off an ATTENDEE parameter list, defaulting to SERVER */
const readScheduleAgent = (
	parameters: ReadonlyArray<{ readonly name: string; readonly value: string }>,
): AttendeeInfo["scheduleAgent"] => {
	const agent = parameters.find((pa) => pa.name === "SCHEDULE-AGENT")?.value;
	if (agent === "CLIENT") {
		return "CLIENT";
	}
	return agent === "NONE" ? "NONE" : "SERVER";
};

/** Every distinct ATTENDEE across the document, first occurrence winning */
export const extractAttendees = (
	doc: IrDocument,
): ReadonlyArray<AttendeeInfo> => {
	const seen = new Set<string>();
	const result: Array<AttendeeInfo> = [];
	for (const comp of schedulableComponents(doc)) {
		for (const prop of comp.properties) {
			if (prop.name !== "ATTENDEE" || prop.value.type !== "CAL_ADDRESS") {
				continue;
			}
			const calAddress = prop.value.value;
			if (seen.has(calAddress.toLowerCase())) {
				continue;
			}
			seen.add(calAddress.toLowerCase());
			result.push({
				calAddress,
				scheduleAgent: readScheduleAgent(prop.parameters),
				rsvp:
					prop.parameters
						.find((pa) => pa.name === "RSVP")
						?.value?.toUpperCase() === "TRUE",
				partstat:
					prop.parameters.find((pa) => pa.name === "PARTSTAT")?.value ??
					"NEEDS-ACTION",
			});
		}
	}
	return result;
};

/** Read the VCALENDAR METHOD value (e.g. "REQUEST"/"REPLY"/"CANCEL"), if any */
export const getMethod = (doc: IrDocument): string | undefined => {
	if (doc.kind !== "icalendar") {
		return undefined;
	}
	const prop = doc.root.properties.find((p) => p.name === "METHOD");
	return prop?.value.type === "TEXT" ? prop.value.value : undefined;
};

export { isSchedulable };
