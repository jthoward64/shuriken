import {
	Effect,
	Match,
	Option,
	Schema,
	SchemaGetter,
	SchemaIssue,
} from "effect";
import type { Temporal } from "temporal-polyfill";
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
	parseStructuredText,
	parseTextList,
	serializeStructuredText,
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
import { VCARD_DEFAULT_TYPES } from "./known.ts";
import { isVCard21, normalizeVCard21 } from "./vcard21.ts";

// ---------------------------------------------------------------------------
// vCard VALUE= parameter override map (lowercase keys per RFC 6350 §5.2)
//
// "DATE_TIME_DYNAMIC" means resolve DATE_TIME vs PLAIN_DATE_TIME at parse time.
// ---------------------------------------------------------------------------

type VcardValueOverride = IrValueType | "DATE_TIME_DYNAMIC";

/**
 * vCard properties whose TEXT value is a structured value (RFC 6350 §3.4):
 * semicolons are field separators, not literal text. We keep these in the IR
 * as a TEXT value whose string preserves the unescaped `;` separators between
 * fields, and route through `parseStructuredText` / `serializeStructuredText`
 * so encode no longer mangles separators into `\;`.
 *
 * Names per RFC 6350 §6.2 (N, ADR), §6.6 (ORG), §6.2.7 (GENDER), §7.3 (CLIENTPIDMAP).
 */
const VCARD_STRUCTURED_PROPS: ReadonlySet<string> = new Set([
	"N",
	"ADR",
	"ORG",
	"GENDER",
	"CLIENTPIDMAP",
]);

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
			URI: (v) => v.value,
			DATE_AND_OR_TIME: (v) => v.value,
			TIME: (v) => v.value,
			UTC_OFFSET: (v) => v.value,
			UTC_OFFSET_INTERVAL: (v) => v.value,
			DURATION: (v) => v.value,
			DURATION_INTERVAL: (v) => v.value,
			CAL_ADDRESS: (v) => v.value,
			RECUR: (v) => v.value,
			PERIOD: (v) => v.value,
		}),
	);

// ---------------------------------------------------------------------------
// Single ContentLine → IrProperty (decode direction)
// ---------------------------------------------------------------------------

// An explicit VALUE=date must yield a DATE; parseDateAndOrTime returns
// DATE_AND_OR_TIME for partial dates, which is not a date value here
const decodeVCardDate = (raw: string): IrValue => {
	const parsed = parseDateAndOrTime(raw);
	return parsed.type === "DATE" ? parsed : { type: "TEXT", value: raw };
};

// RFC 6350 §3.4: for a structured property, split on unescaped `;`, unescape each
// field, then rejoin with literal `;` so the IR retains the structure
const decodeVCardText = (raw: string, name: string): IrValue => ({
	type: "TEXT",
	value: VCARD_STRUCTURED_PROPS.has(name)
		? parseStructuredText(raw).join(";")
		: unescapeText(raw),
});

// Decode a content line's raw value into the IrValue named by its effective
// type. Types not listed here carry their raw string through unchanged.
const decodeIrValue = (
	effectiveType: VcardValueOverride,
	line: ContentLine,
): IrValue => {
	const raw = line.rawValue;
	return Match.value(effectiveType).pipe(
		Match.withReturnType<IrValue>(),
		// TZID param is not common in vCard but handle it for completeness
		Match.whenOr("DATE_TIME_DYNAMIC", "DATE_TIME", () =>
			parseDateTimeString(
				raw,
				line.params.find((p) => p.name.toUpperCase() === "TZID")?.values[0],
			),
		),
		// Parse what Temporal can represent; a partial date stays an opaque string
		Match.when("DATE_AND_OR_TIME", () => parseDateAndOrTime(raw)),
		Match.when("DATE", () => decodeVCardDate(raw)),
		Match.when("TEXT", () => decodeVCardText(raw, line.name)),
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
		Match.whenOr(
			"URI",
			"TIME",
			"UTC_OFFSET",
			"DURATION",
			"CAL_ADDRESS",
			"RECUR",
			"PERIOD",
			(type) => ({ type, value: raw }),
		),
		Match.orElse(() => ({ type: "TEXT", value: raw })),
	);
};

const decodeVCardProperty = (line: ContentLine): IrProperty => {
	const parameters = paramsToIr(line.params);
	const defaultType = VCARD_DEFAULT_TYPES.get(line.name);

	// Unknown / X- properties: store rawValue verbatim as TEXT, no unescaping
	if (defaultType === undefined) {
		return {
			name: line.name,
			parameters,
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
	const effectiveType: VcardValueOverride = override ?? defaultType;

	return {
		name: line.name,
		parameters,
		value: decodeIrValue(effectiveType, line),
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
		if (!(isSelfDescribing || prop.parameters.some((p) => p.name === "TZID"))) {
			throw new Error(
				`Property "${prop.name}" has a non-UTC ZonedDateTime but no TZID parameter`,
			);
		}
	}

	const rawValue =
		prop.isKnown && prop.value.type === "TEXT"
			? VCARD_STRUCTURED_PROPS.has(prop.name)
				? // RFC 6350 §3.4: split on literal `;` and escape each field so
					// separators stay structural and content is properly escaped.
					serializeStructuredText(prop.value.value.split(";"))
				: escapeText(prop.value.value)
			: prop.isKnown
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

// IrComponentSchema / IrDocumentSchema are exported from ir.ts annotated as
// `Schema.Schema<T>`, which hides their `Encoded` type. `decodeTo` needs a
// codec whose `Encoded` is known; `Schema.toType` produces one with
// `Encoded === Type`, which is correct here (both are plain structs).
const IrComponentCodec = Schema.toType(IrComponentSchema);
const IrDocumentCodec = Schema.toType(IrDocumentSchema);

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

const VCardPropertyInferrer = RawComponentSchema.pipe(
	Schema.decodeTo(IrComponentCodec, {
		decode: SchemaGetter.transformOrFail(rawToIr),
		encode: SchemaGetter.transformOrFail(irToRaw),
	}),
);

// ---------------------------------------------------------------------------
// VCardDocumentCodec: Schema<IrDocument, IrComponent>
// ---------------------------------------------------------------------------

// Only a VCARD root makes a vCard document
const componentToDocument = (component: IrComponent) => {
	if (component.name !== "VCARD") {
		return Effect.fail(
			new SchemaIssue.InvalidValue(Option.some(component), {
				message: `Expected VCARD root component, got "${component.name}"`,
			}),
		);
	}
	return Effect.succeed({ kind: "vcard" as const, root: component });
};

// The shared IrDocument also covers iCalendar, so reject the wrong kind here
const documentToComponent = (doc: IrDocument) => {
	if (doc.kind !== "vcard") {
		return Effect.fail(
			new SchemaIssue.InvalidValue(Option.some(doc), {
				message: `Expected vcard document, got kind "${doc.kind}"`,
			}),
		);
	}
	return Effect.succeed(doc.root);
};

const VCardDocumentCodec = IrComponentCodec.pipe(
	Schema.decodeTo(IrDocumentCodec, {
		decode: SchemaGetter.transformOrFail(componentToDocument),
		encode: SchemaGetter.transformOrFail(documentToComponent),
	}),
);

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
export const VCardCodec: Schema.Codec<IrDocument, string> =
	TextToRawComponentCodec.pipe(
		Schema.decodeTo(VCardPropertyInferrer),
		Schema.decodeTo(VCardDocumentCodec),
	);

/**
 * Decode vCard text (2.1, 3.0, or 4.0) → IrDocument.
 * Maps Schema.ParseError → validAddressData DavError.
 */
export const decodeVCard = (
	text: string,
): Effect.Effect<IrDocument, DavError> => {
	const normalized = isVCard21(text) ? normalizeVCard21(text) : text;
	return Schema.decodeUnknownEffect(VCardCodec)(normalized).pipe(
		Effect.mapError((e) => validAddressData(e.message)),
	);
};

/**
 * Encode IrDocument → vCard 4.0 text.
 * Encoding a structurally valid IrDocument cannot fail; panics on internal error.
 */
export const encodeVCard = (doc: IrDocument): Effect.Effect<string, never> =>
	Schema.encodeEffect(VCardCodec)(doc).pipe(Effect.orDie);
