// ---------------------------------------------------------------------------
// Pure iTIP message builders (RFC 5546 / RFC 6638)
// ---------------------------------------------------------------------------

import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import { isSchedulable } from "./itip-extract.ts";

/** An IR document already narrowed to the iCalendar variant */
type IcalDocument = Extract<IrDocument, { kind: "icalendar" }>;

/** A freshly stamped DTSTAMP, as every outgoing iTIP message carries */
const makeDtstampProp = (): IrProperty => ({
	name: "DTSTAMP",
	parameters: [],
	value: { type: "DATE_TIME", value: Temporal.Now.zonedDateTimeISO("UTC") },
	isKnown: true,
});

/** Rebuild a VCALENDAR around the given components, with METHOD forced to `method` */
const asItipMessage = (
	doc: IcalDocument,
	method: string,
	components: ReadonlyArray<IrComponent>,
): IrDocument => {
	const methodProp: IrProperty = {
		name: "METHOD",
		parameters: [],
		value: { type: "TEXT", value: method },
		isKnown: true,
	};
	const carriedProps = doc.root.properties.filter((p) => p.name !== "METHOD");
	return {
		kind: "icalendar",
		root: {
			name: "VCALENDAR",
			properties: [methodProp, ...carriedProps],
			components,
		},
	};
};

/** Drop the server-managed SCHEDULE-STATUS parameter from every ATTENDEE */
const stripScheduleStatus = (comp: IrComponent): IrComponent => ({
	...comp,
	properties: comp.properties.map((p) =>
		p.name === "ATTENDEE"
			? {
					...p,
					parameters: p.parameters.filter(
						(pa) => pa.name !== "SCHEDULE-STATUS",
					),
				}
			: p,
	),
});

/** Bump SEQUENCE and set STATUS:CANCELLED, as an iTIP CANCEL requires */
const asCancelledComponent = (comp: IrComponent): IrComponent => {
	const seqProp = comp.properties.find((p) => p.name === "SEQUENCE");
	const seqValue = seqProp?.value.type === "INTEGER" ? seqProp.value.value : 0;
	return {
		...comp,
		properties: [
			...comp.properties.filter(
				(p) => p.name !== "SEQUENCE" && p.name !== "STATUS",
			),
			{
				name: "SEQUENCE",
				parameters: [],
				value: { type: "INTEGER", value: seqValue + 1 },
				isKnown: true,
			},
			{
				name: "STATUS",
				parameters: [],
				value: { type: "TEXT", value: "CANCELLED" },
				isKnown: true,
			},
		],
	};
};

/** Keep only the replying ATTENDEE and re-stamp DTSTAMP, as an iTIP REPLY requires */
const asReplyComponent = (
	comp: IrComponent,
	replyingCalAddress: string,
): IrComponent => ({
	...comp,
	properties: comp.properties
		.filter((p) => {
			if (p.name !== "ATTENDEE") {
				return true;
			}
			return (
				p.value.type === "CAL_ADDRESS" &&
				p.value.value.toLowerCase() === replyingCalAddress.toLowerCase()
			);
		})
		.map((p) => (p.name === "DTSTAMP" ? makeDtstampProp() : p)),
});

/** Map the schedulable components of a document, leaving others untouched */
const mapSchedulable = (
	doc: IcalDocument,
	f: (comp: IrComponent) => IrComponent,
): ReadonlyArray<IrComponent> =>
	doc.root.components.map((comp) => (isSchedulable(comp) ? f(comp) : comp));

/** Build the iTIP REQUEST sent to attendees (RFC 6638 §3.2.2) */
export const buildItipRequest = (doc: IrDocument): IrDocument =>
	doc.kind === "icalendar"
		? asItipMessage(doc, "REQUEST", mapSchedulable(doc, stripScheduleStatus))
		: doc;

/** Build the iTIP CANCEL sent to attendees (RFC 6638 §3.2.3) */
export const buildItipCancel = (doc: IrDocument): IrDocument =>
	doc.kind === "icalendar"
		? asItipMessage(doc, "CANCEL", mapSchedulable(doc, asCancelledComponent))
		: doc;

/** Build the iTIP REPLY sent to the organizer on behalf of one attendee */
export const buildItipReply = (
	doc: IrDocument,
	replyingCalAddress: string,
): IrDocument =>
	doc.kind === "icalendar"
		? asItipMessage(
				doc,
				"REPLY",
				mapSchedulable(doc, (comp) =>
					asReplyComponent(comp, replyingCalAddress),
				),
			)
		: doc;

/** Force PARTSTAT to `partstat` on every ATTENDEE of every schedulable component */
export const patchPartstat = (
	doc: IrDocument,
	partstat: string,
): IrDocument => {
	if (doc.kind !== "icalendar") {
		return doc;
	}
	return {
		...doc,
		root: {
			...doc.root,
			components: mapSchedulable(doc, (comp) => ({
				...comp,
				properties: comp.properties.map((p) =>
					p.name === "ATTENDEE"
						? {
								...p,
								parameters: [
									...p.parameters.filter((pa) => pa.name !== "PARTSTAT"),
									{ name: "PARTSTAT", value: partstat },
								],
							}
						: p,
				),
			})),
		},
	};
};

/**
 * Strip the VCALENDAR METHOD property. iTIP messages carry METHOD; a calendar
 * object resource stored in a calendar collection MUST NOT (RFC 5545 §3.6 /
 * RFC 6638 §3.1), so auto-placed copies drop it.
 */
export const stripMethod = (doc: IrDocument): IrDocument => {
	if (doc.kind !== "icalendar") {
		return doc;
	}
	return {
		...doc,
		root: {
			...doc.root,
			properties: doc.root.properties.filter((p) => p.name !== "METHOD"),
		},
	};
};
