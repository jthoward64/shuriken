import {
	Effect,
	Match,
	Option,
	Schema,
	SchemaGetter,
	SchemaIssue,
} from "effect";
import type { Temporal } from "temporal-polyfill";
import { type DavError, validCalendarData } from "../../domain/errors.ts";
import {
	type RawComponent,
	RawComponentSchema,
	TextToRawComponentCodec,
} from "../component-tree.ts";
import type { ContentLine } from "../content-line.ts";
import {
	escapeText,
	formatPlainDate,
	formatPlainDateTime,
	formatZonedDateTime,
	getTzidParam,
	getValueParam,
	paramsFromIr,
	paramsToIr,
	parseDateTimeString,
	parsePlainDate,
	parseTextList,
	serializeTextList,
	unescapeText,
} from "../format-utils.ts";
import {
	type IrComponent,
	IrComponentSchema,
	type IrDocument,
	IrDocumentSchema,
	type IrProperty,
	type IrValue,
	type IrValueType,
} from "../ir.ts";
import { ICAL_DEFAULT_TYPES } from "./known.ts";

// ---------------------------------------------------------------------------
// iCal VALUE= parameter override map (UPPERCASE keys per RFC 5545 §3.2.20)
//
// "DATE_TIME_DYNAMIC" signals that the actual type (DATE_TIME vs PLAIN_DATE_TIME)
// must be resolved from rawValue shape (Z suffix) and TZID param at parse time.
// ---------------------------------------------------------------------------

type IcalValueOverride = IrValueType | "DATE_TIME_DYNAMIC";

const ICAL_VALUE_OVERRIDES = new Map<string, IcalValueOverride>([
	["BINARY", "BINARY"],
	["BOOLEAN", "BOOLEAN"],
	["CAL-ADDRESS", "CAL_ADDRESS"],
	["DATE", "DATE"],
	["DATE-TIME", "DATE_TIME_DYNAMIC"],
	["DURATION", "DURATION"],
	["FLOAT", "FLOAT"],
	["INTEGER", "INTEGER"],
	["PERIOD", "PERIOD"],
	["RECUR", "RECUR"],
	["TEXT", "TEXT"],
	["TIME", "TIME"],
	["URI", "URI"],
	["UTC-OFFSET", "UTC_OFFSET"],
]);

// ---------------------------------------------------------------------------
// IrValue encoding (iCal-specific, delegates to format-utils for date/time)
// ---------------------------------------------------------------------------

// A JSON-typed value is serialized through the schema rather than raw JSON
const encodeJson = Schema.encodeSync(Schema.UnknownFromJsonString);

// Every date-time list item is independently anchored or floating, so each is
// formatted by its own shape
const encodeDateTimeListItem = (
	item: Temporal.ZonedDateTime | Temporal.PlainDateTime,
): string =>
	"timeZoneId" in item ? formatZonedDateTime(item) : formatPlainDateTime(item);

const encodeIrValue = (value: IrValue): string =>
	Match.value(value).pipe(
		Match.discriminatorsExhaustive("type")({
			TEXT: (v) => escapeText(v.value),
			TEXT_LIST: (v) => serializeTextList(v.value),
			INTEGER: (v) => String(v.value),
			FLOAT: (v) => String(v.value),
			BOOLEAN: (v) => (v.value ? "TRUE" : "FALSE"),
			DATE: (v) => formatPlainDate(v.value),
			DATE_TIME: (v) => formatZonedDateTime(v.value),
			PLAIN_DATE_TIME: (v) => formatPlainDateTime(v.value),
			DATE_LIST: (v) => v.value.map(formatPlainDate).join(","),
			DATE_TIME_LIST: (v) => v.value.map(encodeDateTimeListItem).join(","),
			PERIOD_LIST: (v) => v.value.join(","),
			BINARY: (v) => btoa(String.fromCodePoint(...v.value)),
			JSON: (v) => encodeJson(v.value),
			DURATION: (v) => v.value,
			URI: (v) => v.value,
			CAL_ADDRESS: (v) => v.value,
			RECUR: (v) => v.value,
			UTC_OFFSET: (v) => v.value,
			UTC_OFFSET_INTERVAL: (v) => v.value,
			DURATION_INTERVAL: (v) => v.value,
			PERIOD: (v) => v.value,
			TIME: (v) => v.value,
			DATE_AND_OR_TIME: (v) => v.value,
		}),
	);

// ---------------------------------------------------------------------------
// Single ContentLine → IrProperty (decode direction)
// ---------------------------------------------------------------------------

// Decode a raw content-line value into the IrValue named by its resolved type.
// Types not listed here carry their raw string through unchanged.
const decodeIrValue = (
	resolvedType: IcalValueOverride,
	raw: string,
	tzid: string | undefined,
): IrValue =>
	Match.value(resolvedType).pipe(
		Match.withReturnType<IrValue>(),
		// Determine DATE_TIME vs PLAIN_DATE_TIME from rawValue shape and TZID param
		Match.whenOr("DATE_TIME_DYNAMIC", "DATE_TIME", () =>
			parseDateTimeString(raw, tzid),
		),
		Match.when("DATE", () => ({ type: "DATE", value: parsePlainDate(raw) })),
		// Each item is independently anchored (UTC "Z", numeric offset, or the
		// property-level TZID) or floating (RFC 5545 Form 1). Floating is valid
		// here — required for RDATE inside a VTIMEZONE observance.
		Match.when("DATE_TIME_LIST", () => ({
			type: "DATE_TIME_LIST",
			value: raw
				.split(",")
				.map((item) => parseDateTimeString(item.trim(), tzid).value),
		})),
		Match.when("DATE_LIST", () => ({
			type: "DATE_LIST",
			value: raw.split(",").map((item) => parsePlainDate(item.trim())),
		})),
		Match.when("TEXT", () => ({ type: "TEXT", value: unescapeText(raw) })),
		Match.when("TEXT_LIST", () => ({
			type: "TEXT_LIST",
			value: parseTextList(raw),
		})),
		Match.when("INTEGER", () => ({
			type: "INTEGER",
			value: Number.parseInt(raw, 10),
		})),
		Match.when("FLOAT", () => ({
			type: "FLOAT",
			value: Number.parseFloat(raw),
		})),
		Match.when("BOOLEAN", () => ({
			type: "BOOLEAN",
			value: raw.toUpperCase() === "TRUE",
		})),
		Match.when("BINARY", () => ({
			type: "BINARY",
			value: Uint8Array.from(atob(raw), (c) => c.codePointAt(0) ?? 0),
		})),
		Match.when("PERIOD_LIST", () => ({
			type: "PERIOD_LIST",
			value: raw.split(","),
		})),
		Match.whenOr(
			"DURATION",
			"URI",
			"CAL_ADDRESS",
			"RECUR",
			"UTC_OFFSET",
			"PERIOD",
			"TIME",
			"UTC_OFFSET_INTERVAL",
			"DURATION_INTERVAL",
			(type) => ({ type, value: raw }),
		),
		Match.orElse(() => ({ type: "TEXT", value: raw })),
	);

const decodeICalProperty = (line: ContentLine): IrProperty => {
	const parameters = paramsToIr(line.params);
	const defaultType = ICAL_DEFAULT_TYPES.get(line.name);

	// Unknown / X- properties: store rawValue verbatim as TEXT, no unescaping
	if (defaultType === undefined) {
		return {
			name: line.name,
			parameters,
			value: { type: "TEXT", value: line.rawValue },
			isKnown: false,
		};
	}

	// Resolve effective value type, checking VALUE= override first
	const overrideKey = getValueParam(line.params)?.toUpperCase();
	const override =
		overrideKey !== undefined
			? ICAL_VALUE_OVERRIDES.get(overrideKey)
			: undefined;
	const effectiveType: IcalValueOverride = override ?? defaultType;

	// Promote singular-type overrides to their list equivalents when the property's
	// default type is a list. This handles EXDATE;VALUE=DATE:20060102,20060103
	// where VALUE=DATE overrides to "DATE" but the raw value is comma-separated.
	const resolvedType: IcalValueOverride =
		effectiveType === "DATE" && defaultType === "DATE_TIME_LIST"
			? "DATE_LIST"
			: effectiveType;

	return {
		name: line.name,
		parameters,
		value: decodeIrValue(
			resolvedType,
			line.rawValue,
			getTzidParam(line.params),
		),
		isKnown: true,
	};
};

// ---------------------------------------------------------------------------
// Single IrProperty → ContentLine (encode direction)
// ---------------------------------------------------------------------------

const encodeICalProperty = (prop: IrProperty): ContentLine => {
	// Guard: a named-timezone ZonedDateTime must have a TZID parameter; without it
	// the encoded value is ambiguous (looks like a floating datetime).
	// UTC and fixed-offset zones are self-describing (Z / ±HHMM suffix) so they
	// do not require a TZID parameter.
	if (prop.isKnown && prop.value.type === "DATE_TIME") {
		const tzId = prop.value.value.timeZoneId;
		const isSelfDescribing =
			tzId === "UTC" || tzId.startsWith("+") || tzId.startsWith("-");
		if (!(isSelfDescribing || prop.parameters.some((p) => p.name === "TZID"))) {
			throw new Error(
				`Property "${prop.name}" has a non-UTC ZonedDateTime but no TZID parameter`,
			);
		}
	}

	const rawValue = prop.isKnown
		? encodeIrValue(prop.value)
		: (prop.value as { value: string }).value;

	// When encoding a DATE_LIST value, ensure VALUE=DATE is present in the
	// parameters. Without it a subsequent decode would interpret the comma-
	// separated dates as DATE_TIME_LIST and fail to parse them.
	let parameters = prop.parameters;
	if (
		prop.isKnown &&
		prop.value.type === "DATE_LIST" &&
		!parameters.some((p) => p.name === "VALUE")
	) {
		parameters = [{ name: "VALUE", value: "DATE" }, ...parameters];
	}

	return {
		name: prop.name,
		params: paramsFromIr(parameters),
		rawValue,
	};
};

// ---------------------------------------------------------------------------
// RawComponent ↔ IrComponent recursion helpers
// ---------------------------------------------------------------------------

const convertRawToIrComponent = (raw: RawComponent): IrComponent => ({
	name: raw.name,
	properties: raw.contentLines.map(decodeICalProperty),
	components: raw.children.map(convertRawToIrComponent),
});

const convertIrToRawComponent = (ir: IrComponent): RawComponent => ({
	name: ir.name,
	contentLines: ir.properties.map(encodeICalProperty),
	children: ir.components.map(convertIrToRawComponent),
});

// ---------------------------------------------------------------------------
// ICalPropertyInferrer: Schema<IrComponent, RawComponent>
// ---------------------------------------------------------------------------

// Property decoding throws on malformed values; surface that as a schema issue
const rawToIr = (
	raw: RawComponent,
): Effect.Effect<IrComponent, SchemaIssue.InvalidValue> =>
	Effect.try({
		try: () => convertRawToIrComponent(raw),
		catch: (e) =>
			new SchemaIssue.InvalidValue(Option.some(raw), { message: String(e) }),
	});

// Property encoding throws on values it cannot represent (e.g. a named-zone
// DATE_TIME with no TZID parameter); surface that as a schema issue
const irToRaw = (
	ir: IrComponent,
): Effect.Effect<RawComponent, SchemaIssue.InvalidValue> =>
	Effect.try({
		try: () => convertIrToRawComponent(ir),
		catch: (e) =>
			new SchemaIssue.InvalidValue(Option.some(ir), { message: String(e) }),
	});

const ICalPropertyInferrer = RawComponentSchema.pipe(
	Schema.decodeTo(Schema.toType(IrComponentSchema), {
		decode: SchemaGetter.transformOrFail(rawToIr),
		encode: SchemaGetter.transformOrFail(irToRaw),
	}),
);

// ---------------------------------------------------------------------------
// ICalDocumentCodec: Schema<IrDocument, IrComponent>
// ---------------------------------------------------------------------------

// Only a VCALENDAR root makes an iCalendar document
const componentToDocument = (component: IrComponent) => {
	if (component.name !== "VCALENDAR") {
		return Effect.fail(
			new SchemaIssue.InvalidValue(Option.some(component), {
				message: `Expected VCALENDAR root component, got "${component.name}"`,
			}),
		);
	}
	return Effect.succeed({ kind: "icalendar" as const, root: component });
};

// The shared IrDocument also covers vCard, so reject the wrong kind here
const documentToComponent = (doc: IrDocument) => {
	if (doc.kind !== "icalendar") {
		return Effect.fail(
			new SchemaIssue.InvalidValue(Option.some(doc), {
				message: `Expected icalendar document, got kind "${doc.kind}"`,
			}),
		);
	}
	return Effect.succeed(doc.root);
};

const ICalDocumentCodec = Schema.toType(IrComponentSchema).pipe(
	Schema.decodeTo(Schema.toType(IrDocumentSchema), {
		decode: SchemaGetter.transformOrFail(componentToDocument),
		encode: SchemaGetter.transformOrFail(documentToComponent),
	}),
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full bidirectional codec: string ↔ IrDocument (iCalendar).
 *
 * Pipeline:
 *   string →[TextToRawComponentCodec] RawComponent
 *          →[ICalPropertyInferrer]    IrComponent
 *          →[ICalDocumentCodec]       IrDocument
 */
export const ICalendarCodec: Schema.Codec<IrDocument, string> =
	TextToRawComponentCodec.pipe(
		Schema.decodeTo(ICalPropertyInferrer),
		Schema.decodeTo(ICalDocumentCodec),
	);

/**
 * Decode iCalendar text → IrDocument.
 * Maps Schema.SchemaError → validCalendarData DavError.
 */
export const decodeICalendar = (
	text: string,
): Effect.Effect<IrDocument, DavError> =>
	Schema.decodeUnknownEffect(ICalendarCodec)(text).pipe(
		Effect.mapError((e) => validCalendarData(e.message)),
	);

/**
 * Encode IrDocument → iCalendar text.
 * Encoding a structurally valid IrDocument cannot fail; panics on internal error.
 */
export const encodeICalendar = (
	doc: IrDocument,
): Effect.Effect<string, never> =>
	Schema.encodeEffect(ICalendarCodec)(doc).pipe(Effect.orDie);

/**
 * Serialize a single IrComponent (e.g. VTIMEZONE) to iCalendar content-line text,
 * including BEGIN: and END: lines. Cannot fail on a structurally valid component.
 *
 * Pipeline (encode direction):
 *   IrComponent →[ICalPropertyInferrer.encode] RawComponent
 *               →[TextToRawComponentCodec.encode] string
 */
export const encodeICalComponent = (
	component: IrComponent,
): Effect.Effect<string, never> =>
	Schema.encodeEffect(ICalPropertyInferrer)(component).pipe(
		Effect.flatMap((raw) => Schema.encodeEffect(TextToRawComponentCodec)(raw)),
		Effect.orDie,
	);
