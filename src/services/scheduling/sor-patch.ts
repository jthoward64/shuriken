// ---------------------------------------------------------------------------
// Pure edits applied to a stored scheduling object resource (RFC 6638 §4)
// ---------------------------------------------------------------------------

import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import { irEquals } from "./ir-equal.ts";
import { isSchedulable } from "./itip-extract.ts";

/** SCHEDULE-STATUS codes per RFC 6638 §9.6 */
export const SCHED_STATUS_DELIVERED = "2.0";
export const SCHED_STATUS_PENDING = "1.2";
export const SCHED_STATUS_FAILED = "5.1";

/** Map the schedulable child components of a root, leaving others untouched */
const mapSchedulable = (
	root: IrComponent,
	f: (comp: IrComponent) => IrComponent,
): IrComponent => ({
	...root,
	components: root.components.map((comp) =>
		isSchedulable(comp) ? f(comp) : comp,
	),
});

/** Replace a named parameter on a property, dropping any previous copies */
const withParameter = (
	prop: IrProperty,
	name: string,
	value: string,
): IrProperty => ({
	...prop,
	parameters: [
		...prop.parameters.filter((pa) => pa.name !== name),
		{ name, value },
	],
});

/**
 * Apply an iTIP REPLY to a scheduling object resource (RFC 6638 §4.2): for each
 * ATTENDEE whose cal-address appears in `replies`, set its PARTSTAT to the
 * replied value and its SCHEDULE-STATUS to "2.0" (delivered). Other properties —
 * and the resource's Schedule-Tag — are untouched.
 */
export const applyReplyToSor = (
	root: IrComponent,
	replies: ReadonlyMap<string, string>,
): IrComponent =>
	mapSchedulable(root, (comp) => ({
		...comp,
		properties: comp.properties.map((p) => {
			if (p.name !== "ATTENDEE" || p.value.type !== "CAL_ADDRESS") {
				return p;
			}
			const partstat = replies.get(p.value.value.toLowerCase());
			if (partstat === undefined) {
				return p;
			}
			return withParameter(
				withParameter(p, "PARTSTAT", partstat),
				"SCHEDULE-STATUS",
				SCHED_STATUS_DELIVERED,
			);
		}),
	}));

/** Set STATUS:CANCELLED on every VEVENT/VTODO (RFC 6638 §4.1 cancellation) */
export const setStatusCancelled = (root: IrComponent): IrComponent =>
	mapSchedulable(root, (comp) => ({
		...comp,
		properties: [
			...comp.properties.filter((p) => p.name !== "STATUS"),
			{
				name: "STATUS",
				parameters: [],
				value: { type: "TEXT" as const, value: "CANCELLED" },
				isKnown: true,
			},
		],
	}));

/** Set SCHEDULE-STATUS on the ATTENDEE matching a given cal-address */
export const applyScheduleStatus = (
	root: IrComponent,
	calAddress: string,
	status: string,
): IrComponent =>
	mapSchedulable(root, (comp) => ({
		...comp,
		properties: comp.properties.map((p) => {
			if (p.name !== "ATTENDEE" || p.value.type !== "CAL_ADDRESS") {
				return p;
			}
			if (p.value.value.toLowerCase() !== calAddress.toLowerCase()) {
				return p;
			}
			return withParameter(p, "SCHEDULE-STATUS", status);
		}),
	}));

/**
 * Canonicalize an iCalendar tree for Schedule-Tag change detection: drop the
 * volatile/per-user bits that don't constitute a "consequential" scheduling
 * change — ATTENDEE PARTSTAT and SCHEDULE-STATUS parameters (participation
 * status) and the DTSTAMP property (re-stamped on every iTIP message). Two
 * trees with the same canonical form differ only in participation status.
 */
const canonicalizeForTag = (comp: IrComponent): IrComponent => {
	if (!isSchedulable(comp)) {
		return { ...comp, components: comp.components.map(canonicalizeForTag) };
	}
	return {
		...comp,
		properties: comp.properties
			.filter((p) => p.name !== "DTSTAMP")
			.map((p) =>
				p.name === "ATTENDEE"
					? {
							...p,
							parameters: p.parameters.filter(
								(pa) => pa.name !== "PARTSTAT" && pa.name !== "SCHEDULE-STATUS",
							),
						}
					: p,
			),
		components: comp.components.map(canonicalizeForTag),
	};
};

/**
 * RFC 6638 §3.2.10 Attendee rule 2: an Organizer update that "only specifies
 * changes in the participation status of Attendees" MUST NOT change the
 * Attendee's Schedule-Tag. True when the two trees are identical apart from
 * ATTENDEE PARTSTAT/SCHEDULE-STATUS (and DTSTAMP).
 */
export const isPartstatOnlyChange = (
	prevRoot: IrComponent,
	nextRoot: IrComponent,
): boolean =>
	irEquals(prevRoot.properties, nextRoot.properties) &&
	irEquals(
		prevRoot.components.map(canonicalizeForTag),
		nextRoot.components.map(canonicalizeForTag),
	);
