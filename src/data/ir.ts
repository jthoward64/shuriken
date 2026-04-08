import { Schema } from "effect";
import type { Temporal } from "temporal-polyfill";

// ---------------------------------------------------------------------------
// Temporal schemas — declared with type-guard predicates since Effect Schema
// has no built-in support for Temporal types.
// ---------------------------------------------------------------------------

export const PlainDateSchema: Schema.Schema<Temporal.PlainDate> =
	Schema.declare(
		(u): u is Temporal.PlainDate =>
			typeof u === "object" &&
			u !== null &&
			typeof (u as Temporal.PlainDate).year === "number" &&
			typeof (u as Temporal.PlainDate).month === "number" &&
			typeof (u as Temporal.PlainDate).day === "number" &&
			!("hour" in u),
		{ identifier: "Temporal.PlainDate" },
	);

export const ZonedDateTimeSchema: Schema.Schema<Temporal.ZonedDateTime> =
	Schema.declare(
		(u): u is Temporal.ZonedDateTime =>
			typeof u === "object" &&
			u !== null &&
			typeof (u as Temporal.ZonedDateTime).timeZoneId === "string" &&
			typeof (u as Temporal.ZonedDateTime).epochNanoseconds === "bigint",
		{ identifier: "Temporal.ZonedDateTime" },
	);

export const PlainDateTimeSchema: Schema.Schema<Temporal.PlainDateTime> =
	Schema.declare(
		(u): u is Temporal.PlainDateTime =>
			typeof u === "object" &&
			u !== null &&
			typeof (u as Temporal.PlainDateTime).year === "number" &&
			typeof (u as Temporal.PlainDateTime).hour === "number" &&
			!("timeZoneId" in u),
		{ identifier: "Temporal.PlainDateTime" },
	);

// ---------------------------------------------------------------------------
// IrParameter
// ---------------------------------------------------------------------------

export const IrParameterSchema = Schema.Struct({
	name: Schema.String,
	// Raw parameter value exactly as it appears after the "=" in the content line.
	// Multi-value parameters (RFC 5545 §3.2) are stored as a comma-joined string
	// matching the single value column in dav_parameter.
	value: Schema.String,
});

export type IrParameter = Schema.Schema.Type<typeof IrParameterSchema>;

// ---------------------------------------------------------------------------
// IrValue — discriminated union matching every value_type in the
// dav_property_value_type_check DB constraint.
//
// DATE_TIME holds only ZonedDateTime (RFC 5545 Form 2: UTC "Z", Form 3: TZID=).
// PLAIN_DATE_TIME holds PlainDateTime (RFC 5545 Form 1: floating, no timezone).
// TEXT is the catch-all for X- and unrecognized IANA properties.
// ---------------------------------------------------------------------------

const IrValueTextSchema = Schema.Struct({
	type: Schema.Literal("TEXT"),
	value: Schema.String,
});
const IrValueIntegerSchema = Schema.Struct({
	type: Schema.Literal("INTEGER"),
	value: Schema.Number,
});
const IrValueFloatSchema = Schema.Struct({
	type: Schema.Literal("FLOAT"),
	value: Schema.Number,
});
const IrValueBooleanSchema = Schema.Struct({
	type: Schema.Literal("BOOLEAN"),
	value: Schema.Boolean,
});
const IrValueDateSchema = Schema.Struct({
	type: Schema.Literal("DATE"),
	value: PlainDateSchema,
});
const IrValueDateTimeSchema = Schema.Struct({
	type: Schema.Literal("DATE_TIME"),
	value: ZonedDateTimeSchema,
});
const IrValuePlainDateTimeSchema = Schema.Struct({
	type: Schema.Literal("PLAIN_DATE_TIME"),
	value: PlainDateTimeSchema,
});
const IrValueDurationSchema = Schema.Struct({
	type: Schema.Literal("DURATION"),
	value: Schema.String,
});
const IrValueUriSchema = Schema.Struct({
	type: Schema.Literal("URI"),
	value: Schema.String,
});
const IrValueBinarySchema = Schema.Struct({
	type: Schema.Literal("BINARY"),
	value: Schema.instanceOf(Uint8Array),
});
const IrValueJsonSchema = Schema.Struct({
	type: Schema.Literal("JSON"),
	value: Schema.Unknown,
});
const IrValueTextListSchema = Schema.Struct({
	type: Schema.Literal("TEXT_LIST"),
	value: Schema.Array(Schema.String),
});
const IrValueDateListSchema = Schema.Struct({
	type: Schema.Literal("DATE_LIST"),
	value: Schema.Array(PlainDateSchema),
});
const IrValueDateTimeListSchema = Schema.Struct({
	type: Schema.Literal("DATE_TIME_LIST"),
	value: Schema.Array(ZonedDateTimeSchema),
});
const IrValueDurationIntervalSchema = Schema.Struct({
	type: Schema.Literal("DURATION_INTERVAL"),
	value: Schema.String,
});
const IrValueUtcOffsetSchema = Schema.Struct({
	type: Schema.Literal("UTC_OFFSET"),
	value: Schema.String,
});
const IrValueUtcOffsetIntervalSchema = Schema.Struct({
	type: Schema.Literal("UTC_OFFSET_INTERVAL"),
	value: Schema.String,
});
const IrValuePeriodSchema = Schema.Struct({
	type: Schema.Literal("PERIOD"),
	value: Schema.String,
});
const IrValuePeriodListSchema = Schema.Struct({
	type: Schema.Literal("PERIOD_LIST"),
	value: Schema.Array(Schema.String),
});
const IrValueTimeSchema = Schema.Struct({
	type: Schema.Literal("TIME"),
	value: Schema.String,
});
const IrValueDateAndOrTimeSchema = Schema.Struct({
	type: Schema.Literal("DATE_AND_OR_TIME"),
	value: Schema.String,
});
const IrValueRecurSchema = Schema.Struct({
	type: Schema.Literal("RECUR"),
	value: Schema.String,
});
const IrValueCalAddressSchema = Schema.Struct({
	type: Schema.Literal("CAL_ADDRESS"),
	value: Schema.String,
});

export const IrValueSchema = Schema.Union(
	IrValueTextSchema,
	IrValueIntegerSchema,
	IrValueFloatSchema,
	IrValueBooleanSchema,
	IrValueDateSchema,
	IrValueDateTimeSchema,
	IrValuePlainDateTimeSchema,
	IrValueDurationSchema,
	IrValueUriSchema,
	IrValueBinarySchema,
	IrValueJsonSchema,
	IrValueTextListSchema,
	IrValueDateListSchema,
	IrValueDateTimeListSchema,
	IrValueDurationIntervalSchema,
	IrValueUtcOffsetSchema,
	IrValueUtcOffsetIntervalSchema,
	IrValuePeriodSchema,
	IrValuePeriodListSchema,
	IrValueTimeSchema,
	IrValueDateAndOrTimeSchema,
	IrValueRecurSchema,
	IrValueCalAddressSchema,
);

export type IrValue = Schema.Schema.Type<typeof IrValueSchema>;

// Convenience: the `type` discriminant tag of any IrValue variant
export type IrValueType = IrValue["type"];

// ---------------------------------------------------------------------------
// IrProperty
// ---------------------------------------------------------------------------

export const IrPropertySchema = Schema.Struct({
	name: Schema.String,
	parameters: Schema.Array(IrParameterSchema),
	value: IrValueSchema,
	// False for X- prefixed and unrecognized IANA properties. These are stored as
	// TEXT and emitted verbatim to ensure lossless round-trip for client extensions.
	isKnown: Schema.Boolean,
});

export type IrProperty = Schema.Schema.Type<typeof IrPropertySchema>;

// ---------------------------------------------------------------------------
// IrComponent — recursive (components may contain sub-components)
// ---------------------------------------------------------------------------

export interface IrComponent {
	readonly name: string;
	readonly properties: ReadonlyArray<IrProperty>;
	readonly components: ReadonlyArray<IrComponent>;
}

export const IrComponentSchema: Schema.Schema<IrComponent> = Schema.Struct({
	name: Schema.String,
	properties: Schema.Array(IrPropertySchema),
	components: Schema.Array(Schema.suspend(() => IrComponentSchema)),
});

// ---------------------------------------------------------------------------
// IrDocument — top-level (VCALENDAR or VCARD)
// ---------------------------------------------------------------------------

export const IrDocumentSchema = Schema.Union(
	Schema.Struct({
		kind: Schema.Literal("icalendar"),
		root: IrComponentSchema, // root.name === "VCALENDAR"
	}),
	Schema.Struct({
		kind: Schema.Literal("vcard"),
		root: IrComponentSchema, // root.name === "VCARD"
	}),
);

export type IrDocument = Schema.Schema.Type<typeof IrDocumentSchema>;

// ---------------------------------------------------------------------------
// DAV dead properties (RFC 4918 §4.1)
//
// Stored in the clientProperties JSONB column on dav_collection and
// dav_instance. The server never interprets the XML values — it only
// round-trips them. Clark-notation keys enable O(1) PROPFIND lookup.
// ---------------------------------------------------------------------------

// Clark notation: "{namespace}localName", e.g. "{http://apple.com/ns/ical/}calendar-color"
export type ClarkName = `{${string}}${string}`;
export const cn = (ns: string, local: string): ClarkName => `{${ns}}${local}`;

export interface IrDeadProperty {
	readonly name: ClarkName;
	// XML fragment string stored and emitted verbatim (simple text or subtree).
	readonly xmlValue: string;
}

// Shape stored in / read from the clientProperties JSONB column.
// Values may be strings (plain-text property values) or objects (nested XML
// subtrees as parsed by fast-xml-parser).  The server never interprets them —
// it only round-trips them through PROPPATCH / PROPFIND.
export type IrDeadProperties = Readonly<Record<ClarkName, unknown>>;
