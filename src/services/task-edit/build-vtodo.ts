/** biome-ignore-all lint/style/noMagicNumbers: date/time padding lengths */
import { Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import type { TaskFormData } from "./types.ts";

// ---------------------------------------------------------------------------
// buildVtodoComponent — pure form → VTODO IR mapper.
//
// Date / datetime handling mirrors `buildVeventComponent` (cal-edit), with
// DTSTART/DUE in place of DTSTART/DTEND — both optional per RFC 5545 §3.6.2.
//
// COMPLETED is not form-owned: `completedAt` is supplied by the caller
// (service.live.ts), which knows whether this is a fresh completion (stamp
// now), a preserved prior completion (carry the existing value), or absent
// (task isn't COMPLETED, so omit it).
//
// RRULE: same `FREQ=…[;COUNT=…][;UNTIL=…]` shape as events.
// ---------------------------------------------------------------------------

const textProp = (name: string, value: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "TEXT", value },
	isKnown: true,
});

/** Parses an ISO date, absent when the value is not a valid calendar date */
const plainDateFrom = Option.liftThrowable((raw: string) =>
	Temporal.PlainDate.from(raw),
);

/** Parses an ISO date-time, absent when the value is not a valid one */
const plainDateTimeFrom = Option.liftThrowable((raw: string) =>
	Temporal.PlainDateTime.from(raw),
);

const formatRruleUntil = (
	raw: string,
	allDay: boolean,
): Option.Option<string> => {
	if (raw === "") {
		return Option.none();
	}
	if (allDay) {
		return Option.map(
			plainDateFrom(raw),
			(d) =>
				`${d.year.toString().padStart(4, "0")}${String(d.month).padStart(2, "0")}${String(d.day).padStart(2, "0")}`,
		);
	}
	return Option.map(plainDateTimeFrom(raw), (dt) => {
		const date = `${dt.year.toString().padStart(4, "0")}${String(dt.month).padStart(2, "0")}${String(dt.day).padStart(2, "0")}`;
		const time = `${String(dt.hour).padStart(2, "0")}${String(dt.minute).padStart(2, "0")}${String(dt.second).padStart(2, "0")}`;
		return `${date}T${time}Z`;
	});
};

const buildDtProp = (
	name: "DTSTART" | "DUE",
	raw: string,
	allDay: boolean,
): Option.Option<IrProperty> => {
	if (raw === "") {
		return Option.none();
	}
	if (allDay) {
		return Option.map(plainDateFrom(raw), (d) => ({
			name,
			parameters: [{ name: "VALUE", value: "DATE" }],
			value: { type: "DATE" as const, value: d },
			isKnown: true,
		}));
	}
	return Option.map(plainDateTimeFrom(raw), (dt) => ({
		name,
		parameters: [],
		value: { type: "PLAIN_DATE_TIME" as const, value: dt },
		isKnown: true,
	}));
};

const buildIntProp = (name: string, raw: string): Option.Option<IrProperty> => {
	const n = raw === "" ? Number.NaN : Number.parseInt(raw, 10);
	return Number.isFinite(n)
		? Option.some({
				name,
				parameters: [],
				value: { type: "INTEGER" as const, value: n },
				isKnown: true,
			})
		: Option.none();
};

export const buildVtodoComponent = (
	uid: string,
	form: TaskFormData,
	completedAt: Option.Option<Temporal.ZonedDateTime>,
): Option.Option<IrComponent> =>
	form.summary === ""
		? Option.none()
		: Option.some(assembleVtodo(uid, form, completedAt));

/** Assembles the VTODO body once the form is known to carry a summary. */
const assembleVtodo = (
	uid: string,
	form: TaskFormData,
	completedAt: Option.Option<Temporal.ZonedDateTime>,
): IrComponent => {
	const props: Array<IrProperty> = [
		{
			name: "UID",
			parameters: [],
			value: { type: "TEXT", value: uid },
			isKnown: true,
		},
		textProp("SUMMARY", form.summary),
	];

	props.push(
		...Option.toArray(buildDtProp("DTSTART", form.start, form.allDay)),
	);
	props.push(...Option.toArray(buildDtProp("DUE", form.due, form.allDay)));
	if (form.description !== "") {
		props.push(textProp("DESCRIPTION", form.description));
	}
	if (form.location !== "") {
		props.push(textProp("LOCATION", form.location));
	}
	const categories = form.categoriesCsv
		.split(",")
		.map((c) => c.trim())
		.filter((c) => c !== "");
	if (categories.length > 0) {
		props.push({
			name: "CATEGORIES",
			parameters: [],
			value: { type: "TEXT_LIST", value: categories },
			isKnown: true,
		});
	}
	if (form.status !== "") {
		props.push(textProp("STATUS", form.status));
	}
	props.push(
		...Option.toArray(
			Option.map(completedAt, (value) => ({
				name: "COMPLETED",
				parameters: [],
				value: { type: "DATE_TIME" as const, value },
				isKnown: true,
			})),
		),
	);
	props.push(...Option.toArray(buildIntProp("PRIORITY", form.priority)));
	props.push(
		...Option.toArray(buildIntProp("PERCENT-COMPLETE", form.percentComplete)),
	);

	if (form.recurrenceFreq !== "") {
		const parts: Array<string> = [`FREQ=${form.recurrenceFreq}`];
		const count = Number.parseInt(form.recurrenceCount, 10);
		if (Number.isFinite(count) && count > 0) {
			parts.push(`COUNT=${count}`);
		} else {
			parts.push(
				...Option.toArray(
					Option.map(
						formatRruleUntil(form.recurrenceUntil, form.allDay),
						(until) => `UNTIL=${until}`,
					),
				),
			);
		}
		props.push({
			name: "RRULE",
			parameters: [],
			value: { type: "RECUR", value: parts.join(";") },
			isKnown: true,
		});
	}

	return {
		name: "VTODO",
		properties: props,
		components: [],
	};
};
