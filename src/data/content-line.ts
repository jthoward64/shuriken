import { Effect, ParseResult, Schema } from "effect";

// ---------------------------------------------------------------------------
// UTF-8 encoding thresholds and byte-widths (RFC 3629)
// ---------------------------------------------------------------------------

const Utf8Max1Byte = 0x80; // code points < 0x80 encode as 1 byte
const Utf8Max2Byte = 0x800; // code points < 0x800 encode as 2 bytes
const Utf8Max3Byte = 0x10000; // code points < 0x10000 encode as 3 bytes
const Utf8Width1 = 1;
const Utf8Width2 = 2;
const Utf8Width3 = 3;
const Utf8Width4 = 4;
// Smallest code point that requires a surrogate pair in UTF-16 (U+10000)
const SurrogatePairMin = 0x10000;

// ---------------------------------------------------------------------------
// ContentLine — a single logical RFC 5545 / RFC 6350 content line
//
// Both iCalendar (RFC 5545 §3.1) and vCard (RFC 6350 §3.2) share identical
// line-folding rules and the same NAME;PARAM=VALUE:raw-value grammar. This
// module owns that shared layer so format-specific codecs stay DRY.
//
// "Logical line" means after unfolding (CRLF+WSP continuation stripped). The
// rawValue field is verbatim — value-type inference happens in the format codec.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types (Schema-derived)
// ---------------------------------------------------------------------------

export const ContentLineParamSchema = Schema.Struct({
	name: Schema.String,
	// Individual values after splitting at unquoted commas (RFC 5545 §3.2).
	// Single-value params have exactly one entry.
	values: Schema.Array(Schema.String),
});
export type ContentLineParam = Schema.Schema.Type<typeof ContentLineParamSchema>;

export const ContentLineSchema = Schema.Struct({
	// Upper-cased component or property name (e.g. "DTSTART", "BEGIN").
	name: Schema.String,
	params: Schema.Array(ContentLineParamSchema),
	// Verbatim text after the first unquoted ":" — not yet type-inferred.
	rawValue: Schema.String,
});
export type ContentLine = Schema.Schema.Type<typeof ContentLineSchema>;

// ---------------------------------------------------------------------------
// Encoding helpers (pure — no Effect)
// ---------------------------------------------------------------------------

/** Strip wrapping double-quotes from a parameter value if present. */
const stripQuotes = (v: string): string =>
	v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;

/**
 * RFC 6868: decode `^`-escape sequences in a parameter value.
 *   `^^` → `^`    `^'` → `"`    `^n` / `^N` → newline
 */
const decodeParamValue = (v: string): string =>
	v.replace(/\^(\^|'|n|N)/g, (_, ch: string) => {
		if (ch === "'") {
			return '"';
		}
		if (ch === "n" || ch === "N") {
			return "\n";
		}
		return "^";
	});

/**
 * RFC 6868: encode special characters in a parameter value.
 *   `^` → `^^`    `"` → `^'`    newline → `^n`
 * Applied before quoting so the encoded value never contains bare `"`.
 */
const encodeParamValue = (v: string): string =>
	v.replace(/\^/g, "^^").replace(/\n/g, "^n").replace(/"/g, "^'");

/** Return true if a parameter value requires quoting (contains ; : or ,). */
const needsQuoting = (v: string): boolean => /[;:,]/.test(v);

/**
 * Serialize a single parameter value.
 * Uses RFC 6868 `^`-encoding when the value contains `^`, `"`, or newline;
 * falls back to double-quoting for values that contain only `;`, `:`, or `,`.
 */
const serializeParamValue = (v: string): string => {
	if (/[\^"\n]/.test(v)) {
		// RFC 6868 encoding required; still quote if ; : , are also present
		const encoded = encodeParamValue(v);
		return needsQuoting(encoded) ? `"${encoded}"` : encoded;
	}
	return needsQuoting(v) ? `"${v}"` : v;
};

/** Serialize a single ContentLine to its unfolded logical-line string. */
const serializeLogicalLine = (line: ContentLine): string => {
	const paramStr = line.params
		.map((p) => {
			const values = p.values.map(serializeParamValue).join(",");
			return `${p.name}=${values}`;
		})
		.join(";");
	const nameAndParams = paramStr ? `${line.name};${paramStr}` : line.name;
	return `${nameAndParams}:${line.rawValue}`;
};

/**
 * Fold a logical line to physical lines of ≤75 UTF-8 octets each (RFC 5545 §3.1).
 * Continuation physical lines are prefixed with a single SPACE (1 octet), so
 * each continuation chunk holds at most 74 octets of content.
 */
const foldLogicalLine = (line: string): string => {
	const MaxFirst = 75;
	const MaxCont = 74; // 75 - 1 for the leading space

	const getUtf8ByteLen = (cp: number): number =>
		cp < Utf8Max1Byte
			? Utf8Width1
			: cp < Utf8Max2Byte
				? Utf8Width2
				: cp < Utf8Max3Byte
					? Utf8Width3
					: Utf8Width4;

	const parts: Array<string> = [];
	let charOffset = 0;
	let isFirst = true;

	while (charOffset < line.length) {
		const maxBytes = isFirst ? MaxFirst : MaxCont;
		let chunkEnd = charOffset;
		let chunkBytes = 0;

		while (chunkEnd < line.length) {
			const cp = line.codePointAt(chunkEnd) ?? 0;
			const byteLen = getUtf8ByteLen(cp);
			if (chunkBytes + byteLen > maxBytes) { break; }
			chunkBytes += byteLen;
			// Advance by 2 for surrogate pairs, 1 otherwise
			chunkEnd += cp >= SurrogatePairMin ? Utf8Width2 : Utf8Width1;
		}

		// Guard: if we couldn't advance even one code point (shouldn't happen in
		// practice with valid UTF-8), force-advance to avoid an infinite loop.
		if (chunkEnd === charOffset) { chunkEnd += 1; }

		parts.push(line.slice(charOffset, chunkEnd));
		charOffset = chunkEnd;
		isFirst = false;
	}

	return parts.join("\r\n ");
};

// ---------------------------------------------------------------------------
// Parsing helpers (pure — throw on error for wrapping in ParseResult)
// ---------------------------------------------------------------------------

/**
 * Normalize mixed line endings to CRLF then unfold continuation lines.
 * Returns the resulting logical lines (empty lines discarded).
 *
 * RFC 5545 §3.1: unfolding strips CRLF immediately followed by WSP.
 */
const splitAndUnfold = (text: string): Array<string> => {
	// Normalize to CRLF
	const crlf = text.replace(/\r\n|\r|\n/g, "\r\n");
	// Unfold: remove CRLF followed by a single SPACE or TAB
	const unfolded = crlf.replace(/\r\n[ \t]/g, "");
	return unfolded.split("\r\n").filter((l) => l.length > 0);
};

/**
 * Split a string at `;` or `,` characters that are NOT inside double-quoted
 * segments. Used for both param splitting and param-value splitting.
 */
const splitUnquoted = (str: string, sep: ";" | ","): Array<string> => {
	const parts: Array<string> = [];
	let current = "";
	let inQuote = false;
	for (const ch of str) {
		if (ch === '"') {
			inQuote = !inQuote;
			current += ch;
		} else if (ch === sep && !inQuote) {
			parts.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	parts.push(current);
	return parts;
};

/** Parse a single `PARAM-NAME=value1,value2` string into a ContentLineParam. */
const parseParam = (raw: string): ContentLineParam => {
	const eqIdx = raw.indexOf("=");
	if (eqIdx === -1) {
		// Bare param name with no value (some clients emit these) — treat as empty
		return { name: raw.toUpperCase(), values: [] };
	}
	const name = raw.slice(0, eqIdx).toUpperCase();
	const rawValues = splitUnquoted(raw.slice(eqIdx + 1), ",");
	return { name, values: rawValues.map((v) => decodeParamValue(stripQuotes(v))) };
};

/**
 * Parse a single unfolded logical line into a ContentLine.
 * Throws a descriptive string on structural error (no colon, etc.).
 */
const parseLogicalLine = (line: string): ContentLine => {
	// Find the first `:` that is not inside a quoted parameter value.
	// Parameter values come before the `:`, so we scan for quotes only in
	// that portion — but we don't know where it ends yet. Walk character-by-
	// character tracking quote state; the first unquoted `:` is the delimiter.
	let inQuote = false;
	let colonIdx = -1;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			inQuote = !inQuote;
		} else if (ch === ":" && !inQuote) {
			colonIdx = i;
			break;
		}
	}
	if (colonIdx === -1) {
		throw new Error(`Content line has no colon separator: "${line}"`);
	}

	const nameAndParams = line.slice(0, colonIdx);
	const rawValue = line.slice(colonIdx + 1);

	// Split name+params at unquoted `;`
	const segments = splitUnquoted(nameAndParams, ";");
	const name = (segments[0] ?? "").toUpperCase();
	if (!name) { throw new Error(`Content line has empty name: "${line}"`); }

	const params = segments.slice(1).map(parseParam);

	return { name, params, rawValue };
};

// ---------------------------------------------------------------------------
// ContentLinesCodec
//
// Schema<ReadonlyArray<ContentLine>, string>
//   decode: string → ReadonlyArray<ContentLine>
//   encode: ReadonlyArray<ContentLine> → string
// ---------------------------------------------------------------------------

export const ContentLinesCodec: Schema.Schema<
	ReadonlyArray<ContentLine>,
	string
> = Schema.transformOrFail(
	Schema.String,
	Schema.Array(ContentLineSchema),
	{
		strict: true,
		decode: (text, _options, ast) =>
			Effect.try({
				try: () => splitAndUnfold(text).map(parseLogicalLine),
				catch: (e) =>
					new ParseResult.Type(ast, text, String(e)),
			}),
		encode: (lines, _options, ast) =>
			Effect.try({
				try: () =>
					lines
						.map((l) => foldLogicalLine(serializeLogicalLine(l)))
						.join("\r\n")
						.concat("\r\n"),
				catch: (e) =>
					new ParseResult.Type(ast, lines, String(e)),
			}),
	},
);
