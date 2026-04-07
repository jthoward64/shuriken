import { Effect, ParseResult, Schema } from "effect";
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
	type IrDocument,
	type IrProperty,
	type IrValue,
	type IrValueType,
	IrComponentSchema,
	IrDocumentSchema,
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

const encodeIrValue = (value: IrValue): string => {
	switch (value.type) {
		case "TEXT":
			return escapeText(value.value);
		case "TEXT_LIST":
			return serializeTextList(value.value);
		case "INTEGER":
		case "FLOAT":
			return String(value.value);
		case "BOOLEAN":
			return value.value ? "TRUE" : "FALSE";
		case "DATE":
			return formatPlainDate(value.value);
		case "DATE_TIME":
			return formatZonedDateTime(value.value);
		case "PLAIN_DATE_TIME":
			return formatPlainDateTime(value.value);
		case "DATE_LIST":
			return value.value.map(formatPlainDate).join(",");
		case "DATE_TIME_LIST":
			return value.value.map(formatZonedDateTime).join(",");
		case "PERIOD_LIST":
			return value.value.join(",");
		case "BINARY":
			return btoa(String.fromCodePoint(...value.value));
		case "JSON":
			return JSON.stringify(value.value);
		case "DURATION":
		case "URI":
		case "CAL_ADDRESS":
		case "RECUR":
		case "UTC_OFFSET":
		case "UTC_OFFSET_INTERVAL":
		case "DURATION_INTERVAL":
		case "PERIOD":
		case "TIME":
		case "DATE_AND_OR_TIME":
			return value.value;
	}
};

// ---------------------------------------------------------------------------
// Single ContentLine → IrProperty (decode direction)
// ---------------------------------------------------------------------------

const decodeICalProperty = (line: ContentLine): IrProperty => {
	const isKnown = ICAL_DEFAULT_TYPES.has(line.name);

	// Unknown / X- properties: store rawValue verbatim as TEXT, no unescaping
	if (!isKnown) {
		return {
			name: line.name,
			parameters: paramsToIr(line.params),
			value: { type: "TEXT", value: line.rawValue },
			isKnown: false,
		};
	}

	// Resolve effective value type, checking VALUE= override first
	const valueParamRaw = getValueParam(line.params);
	const overrideKey = valueParamRaw?.toUpperCase();
	const override =
		overrideKey !== undefined ? ICAL_VALUE_OVERRIDES.get(overrideKey) : undefined;
	const defaultType = ICAL_DEFAULT_TYPES.get(line.name) as IrValueType;
	const effectiveType: IcalValueOverride = override ?? defaultType;

	const tzid = getTzidParam(line.params);
	const raw = line.rawValue;

	// Promote singular-type overrides to their list equivalents when the property's
	// default type is a list. This handles EXDATE;VALUE=DATE:20060102,20060103
	// where VALUE=DATE overrides to "DATE" but the raw value is comma-separated.
	const resolvedType: IcalValueOverride =
		effectiveType === "DATE" && defaultType === "DATE_TIME_LIST"
			? "DATE_LIST"
			: effectiveType;

	let value: IrValue;

	if (resolvedType === "DATE_TIME_DYNAMIC" || resolvedType === "DATE_TIME") {
		// Determine DATE_TIME vs PLAIN_DATE_TIME from rawValue shape and TZID param
		value = parseDateTimeString(raw, tzid);
	} else {
		switch (resolvedType) {
			case "DATE":
				value = { type: "DATE", value: parsePlainDate(raw) };
				break;
			case "DATE_TIME_LIST": {
				// Each item may be UTC or TZID-qualified; TZID param applies to all
				const parsed = raw.split(",").map((item) => {
					const r = parseDateTimeString(item.trim(), tzid);
					if (r.type !== "DATE_TIME") {
						throw new Error(
							`DATE_TIME_LIST item "${item}" is floating — TZID or Z required`,
						);
					}
					return r.value;
				});
				value = { type: "DATE_TIME_LIST", value: parsed };
				break;
			}
			case "DATE_LIST":
				value = {
					type: "DATE_LIST",
					value: raw.split(",").map((item) => parsePlainDate(item.trim())),
				};
				break;
			case "TEXT":
				value = { type: "TEXT", value: unescapeText(raw) };
				break;
			case "TEXT_LIST":
				value = { type: "TEXT_LIST", value: parseTextList(raw) };
				break;
			case "INTEGER":
				value = { type: "INTEGER", value: Number.parseInt(raw, 10) };
				break;
			case "FLOAT":
				value = { type: "FLOAT", value: Number.parseFloat(raw) };
				break;
			case "BOOLEAN":
				value = { type: "BOOLEAN", value: raw.toUpperCase() === "TRUE" };
				break;
			case "BINARY":
				value = {
					type: "BINARY",
					value: Uint8Array.from(atob(raw), (c) => c.codePointAt(0) ?? 0),
				};
				break;
			case "PERIOD_LIST":
				value = { type: "PERIOD_LIST", value: raw.split(",") };
				break;
			case "DURATION":
			case "URI":
			case "CAL_ADDRESS":
			case "RECUR":
			case "UTC_OFFSET":
			case "PERIOD":
			case "TIME":
			case "UTC_OFFSET_INTERVAL":
			case "DURATION_INTERVAL":
				value = { type: resolvedType, value: raw };
				break;
			default:
				value = { type: "TEXT", value: raw };
		}
	}

	return {
		name: line.name,
		parameters: paramsToIr(line.params),
		value,
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
		if (!isSelfDescribing && !prop.parameters.some((p) => p.name === "TZID")) {
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

const ICalPropertyInferrer: Schema.Schema<IrComponent, RawComponent> =
	Schema.transformOrFail(RawComponentSchema, IrComponentSchema, {
		strict: true,
		decode: (raw, _options, ast) =>
			Effect.try({
				try: () => convertRawToIrComponent(raw),
				catch: (e) => new ParseResult.Type(ast, raw, String(e)),
			}),
		encode: (ir, _options, ast) =>
			Effect.try({
				try: () => convertIrToRawComponent(ir),
				catch: (e) => new ParseResult.Type(ast, ir, String(e)),
			}),
	});

// ---------------------------------------------------------------------------
// ICalDocumentCodec: Schema<IrDocument, IrComponent>
// ---------------------------------------------------------------------------

const ICalDocumentCodec: Schema.Schema<IrDocument, IrComponent> =
	Schema.transformOrFail(IrComponentSchema, IrDocumentSchema, {
		strict: true,
		decode: (component, _options, ast) => {
			if (component.name !== "VCALENDAR") {
				return ParseResult.fail(
					new ParseResult.Type(
						ast,
						component,
						`Expected VCALENDAR root component, got "${component.name}"`,
					),
				);
			}
			return ParseResult.succeed({ kind: "icalendar" as const, root: component });
		},
		encode: (doc, _options, ast) => {
			if (doc.kind !== "icalendar") {
				return ParseResult.fail(
					new ParseResult.Type(
						ast,
						doc,
						`Expected icalendar document, got kind "${doc.kind}"`,
					),
				);
			}
			return ParseResult.succeed(doc.root);
		},
	});

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
export const ICalendarCodec: Schema.Schema<IrDocument, string> =
	TextToRawComponentCodec.pipe(
		Schema.compose(ICalPropertyInferrer),
		Schema.compose(ICalDocumentCodec),
	);

/**
 * Decode iCalendar text → IrDocument.
 * Maps Schema.ParseError → validCalendarData DavError.
 */
export const decodeICalendar = (
	text: string,
): Effect.Effect<IrDocument, DavError> =>
	Schema.decodeUnknown(ICalendarCodec)(text).pipe(
		Effect.mapError((e) => validCalendarData(e.message)),
	);

/**
 * Encode IrDocument → iCalendar text.
 * Encoding a structurally valid IrDocument cannot fail; panics on internal error.
 */
export const encodeICalendar = (doc: IrDocument): Effect.Effect<string, never> =>
	Schema.encode(ICalendarCodec)(doc).pipe(Effect.orDie);

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
	Schema.encode(ICalPropertyInferrer)(component).pipe(
		Effect.flatMap((raw) => Schema.encode(TextToRawComponentCodec)(raw)),
		Effect.orDie,
	);
