import { Effect } from "effect";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
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
}

const wrapInVcalendarWithMethod = (
	method: ImipMethod,
	vevent: IrComponent,
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
			components: [vevent],
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
		const doc = wrapInVcalendarWithMethod(input.method, input.vevent);
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
// normalized to lowercase with any "mailto:" prefix stripped. Returns null if
// the property is absent.
export const extractOrganizerAddress = (vevent: IrComponent): string | null => {
	const p = vevent.properties.find((pp) => pp.name === "ORGANIZER");
	if (!p) {
		return null;
	}
	const raw =
		p.value.type === "URI" || p.value.type === "TEXT"
			? p.value.value
			: p.value.type === "CAL_ADDRESS"
				? p.value.value
				: "";
	if (raw === "") {
		return null;
	}
	const lower = raw.toLowerCase();
	return lower.startsWith("mailto:") ? lower.slice("mailto:".length) : lower;
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
