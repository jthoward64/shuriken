import { Effect, ParseResult, Schema } from "effect";
import { type DavError, validAddressData } from "../../domain/errors.ts";
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
	getValueParam,
	paramsFromIr,
	paramsToIr,
	parseDateAndOrTime,
	parseDateTimeString,
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
import { isVCard21, normalizeVCard21 } from "./vcard21.ts";
import { VCARD_DEFAULT_TYPES } from "./known.ts";

// ---------------------------------------------------------------------------
// vCard VALUE= parameter override map (lowercase keys per RFC 6350 §5.2)
//
// "DATE_TIME_DYNAMIC" means resolve DATE_TIME vs PLAIN_DATE_TIME at parse time.
// ---------------------------------------------------------------------------

type VcardValueOverride = IrValueType | "DATE_TIME_DYNAMIC";

const VCARD_VALUE_OVERRIDES = new Map<string, VcardValueOverride>([
	["text", "TEXT"],
	["uri", "URI"],
	["date", "DATE"],
	["date-time", "DATE_TIME_DYNAMIC"],
	["timestamp", "DATE_TIME_DYNAMIC"],
	["date-and-or-time", "DATE_AND_OR_TIME"],
	["time", "TIME"],
	["boolean", "BOOLEAN"],
	["integer", "INTEGER"],
	["float", "FLOAT"],
	["utc-offset", "UTC_OFFSET"],
	["language-tag", "TEXT"],
	["text-list", "TEXT_LIST"],
]);

// ---------------------------------------------------------------------------
// IrValue encoding (vCard-specific, delegates to format-utils)
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
		case "URI":
		case "DATE_AND_OR_TIME":
		case "TIME":
		case "UTC_OFFSET":
		case "UTC_OFFSET_INTERVAL":
		case "DURATION":
		case "DURATION_INTERVAL":
		case "CAL_ADDRESS":
		case "RECUR":
		case "PERIOD":
			return value.value;
	}
};

// ---------------------------------------------------------------------------
// Single ContentLine → IrProperty (decode direction)
// ---------------------------------------------------------------------------

const decodeVCardProperty = (line: ContentLine): IrProperty => {
	const isKnown = VCARD_DEFAULT_TYPES.has(line.name);

	// Unknown / X- properties: store rawValue verbatim as TEXT, no unescaping
	if (!isKnown) {
		return {
			name: line.name,
			parameters: paramsToIr(line.params),
			value: { type: "TEXT", value: line.rawValue },
			isKnown: false,
		};
	}

	// Resolve effective value type — VALUE= param is lowercase in vCard
	const valueParamRaw = getValueParam(line.params);
	const override =
		valueParamRaw !== undefined
			? VCARD_VALUE_OVERRIDES.get(valueParamRaw.toLowerCase())
			: undefined;
	const defaultType = VCARD_DEFAULT_TYPES.get(line.name) as IrValueType;
	const effectiveType: VcardValueOverride = override ?? defaultType;

	const raw = line.rawValue;
	let value: IrValue;

	if (effectiveType === "DATE_TIME_DYNAMIC" || effectiveType === "DATE_TIME") {
		// TZID param is not common in vCard but handle it for completeness
		const tzid = line.params.find((p) => p.name.toUpperCase() === "TZID")?.values[0];
		value = parseDateTimeString(raw, tzid);
	} else if (effectiveType === "DATE_AND_OR_TIME") {
		// Parse what Temporal can represent; fall back to opaque string for partial dates
		value = parseDateAndOrTime(raw);
	} else {
		switch (effectiveType) {
			case "DATE":
				value = parseDateAndOrTime(raw);
				// parseDateAndOrTime may return DATE_AND_OR_TIME for edge cases;
				// ensure we got a DATE when explicitly requested
				if (value.type !== "DATE") {
					value = { type: "TEXT", value: raw };
				}
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
			case "URI":
			case "TIME":
			case "UTC_OFFSET":
			case "DURATION":
			case "CAL_ADDRESS":
			case "RECUR":
			case "PERIOD":
				value = { type: effectiveType, value: raw };
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

const encodeVCardProperty = (prop: IrProperty): ContentLine => {
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
	return {
		name: prop.name,
		params: paramsFromIr(prop.parameters),
		rawValue,
	};
};

// ---------------------------------------------------------------------------
// RawComponent ↔ IrComponent recursion helpers
// ---------------------------------------------------------------------------

const convertRawToIrComponent = (raw: RawComponent): IrComponent => ({
	name: raw.name,
	properties: raw.contentLines.map(decodeVCardProperty),
	components: raw.children.map(convertRawToIrComponent),
});

const convertIrToRawComponent = (ir: IrComponent): RawComponent => ({
	name: ir.name,
	contentLines: ir.properties.map(encodeVCardProperty),
	children: ir.components.map(convertIrToRawComponent),
});

// ---------------------------------------------------------------------------
// VCardPropertyInferrer: Schema<IrComponent, RawComponent>
// ---------------------------------------------------------------------------

const VCardPropertyInferrer: Schema.Schema<IrComponent, RawComponent> =
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
// VCardDocumentCodec: Schema<IrDocument, IrComponent>
// ---------------------------------------------------------------------------

const VCardDocumentCodec: Schema.Schema<IrDocument, IrComponent> =
	Schema.transformOrFail(IrComponentSchema, IrDocumentSchema, {
		strict: true,
		decode: (component, _options, ast) => {
			if (component.name !== "VCARD") {
				return ParseResult.fail(
					new ParseResult.Type(
						ast,
						component,
						`Expected VCARD root component, got "${component.name}"`,
					),
				);
			}
			return ParseResult.succeed({ kind: "vcard" as const, root: component });
		},
		encode: (doc, _options, ast) => {
			if (doc.kind !== "vcard") {
				return ParseResult.fail(
					new ParseResult.Type(
						ast,
						doc,
						`Expected vcard document, got kind "${doc.kind}"`,
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
 * Full bidirectional codec: string ↔ IrDocument (vCard).
 *
 * Handles vCard 3.0 and 4.0. For vCard 2.1 use `decodeVCard` which
 * normalizes the input before passing it here.
 *
 * Pipeline:
 *   string →[TextToRawComponentCodec]  RawComponent
 *          →[VCardPropertyInferrer]    IrComponent
 *          →[VCardDocumentCodec]       IrDocument
 */
export const VCardCodec: Schema.Schema<IrDocument, string> =
	TextToRawComponentCodec.pipe(
		Schema.compose(VCardPropertyInferrer),
		Schema.compose(VCardDocumentCodec),
	);

/**
 * Decode vCard text (2.1, 3.0, or 4.0) → IrDocument.
 * Maps Schema.ParseError → validAddressData DavError.
 */
export const decodeVCard = (text: string): Effect.Effect<IrDocument, DavError> => {
	const normalized = isVCard21(text) ? normalizeVCard21(text) : text;
	return Schema.decodeUnknown(VCardCodec)(normalized).pipe(
		Effect.mapError((e) => validAddressData(e.message)),
	);
};

/**
 * Encode IrDocument → vCard 4.0 text.
 * Encoding a structurally valid IrDocument cannot fail; panics on internal error.
 */
export const encodeVCard = (doc: IrDocument): Effect.Effect<string, never> =>
	Schema.encode(VCardCodec)(doc).pipe(Effect.orDie);
