/**
 * vCard 2.1 normalization pre-processor.
 *
 * vCard 2.1 has two structural differences from 3.0/4.0 that must be resolved
 * before the standard ContentLinesCodec can handle the input:
 *
 *   1. Bare parameters — `TEL;WORK;VOICE:+1-555-5555`
 *      Bare names (no `=`) are TYPE hints in 2.1. They are normalized to
 *      explicit named parameters: `TEL;TYPE=WORK,VOICE:+1-555-5555`.
 *      Exception: `PREF` becomes `PREF=1` (numeric in vCard 4.0, not a TYPE).
 *
 *   2. QUOTED-PRINTABLE soft line breaks
 *      A property with `ENCODING=QUOTED-PRINTABLE` may use `=` at the end of
 *      a physical line as a soft-break continuation. These must be joined
 *      *before* the normal CRLF+WSP unfolding runs, then the QP-encoded value
 *      is decoded so the codec sees plain text.
 */

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Return true if the text contains a VERSION:2.1 line (case-insensitive). */
export const isVCard21 = (text: string): boolean =>
	/(?:^|\r?\n)VERSION:2\.1(?:\r?\n|$)/i.test(text);

// ---------------------------------------------------------------------------
// QUOTED-PRINTABLE decoding
// ---------------------------------------------------------------------------

/**
 * Decode a QUOTED-PRINTABLE-encoded string.
 * Handles `=XX` hex sequences and `=\r\n` / `=\n` soft line-break removal.
 */
const decodeQp = (raw: string): string => {
	// Remove soft line breaks (= at end of line)
	const joined = raw.replace(/=\r?\n/g, "");
	// Decode =XX hex pairs
	return joined.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
		String.fromCodePoint(Number.parseInt(hex, 16)),
	);
};

// ---------------------------------------------------------------------------
// Bare parameter normalization
// ---------------------------------------------------------------------------

/**
 * `PREF` in vCard 2.1 is a preference indicator (boolean); in 3.0/4.0 PREF is
 * a numeric parameter. Normalise bare PREF to PREF=1.
 */
const BARE_PREF = "PREF";

/**
 * Normalize the parameter section of a single property line.
 *
 * `paramSection` is the text between the property name and the `:` delimiter,
 * e.g. `WORK;VOICE` from `TEL;WORK;VOICE:+1-555-5555`.
 *
 * Returns the normalized parameter string (without leading `;`).
 */
const normalizeParamSection = (paramSection: string): string => {
	if (!paramSection) { return ""; }

	const segments = paramSection.split(";").filter((s) => s.length > 0);
	const typeValues: Array<string> = [];
	const namedParams: Array<string> = [];
	let prefValue: string | undefined;

	for (const seg of segments) {
		if (seg.includes("=")) {
			// Named parameter — keep as-is
			namedParams.push(seg);
		} else {
			// Bare parameter
			const upper = seg.toUpperCase();
			if (upper === BARE_PREF) {
				prefValue = "1";
			} else {
				typeValues.push(upper);
			}
		}
	}

	const result: Array<string> = [];
	if (typeValues.length > 0) {
		result.push(`TYPE=${typeValues.join(",")}`);
	}
	if (prefValue !== undefined) {
		result.push(`PREF=${prefValue}`);
	}
	result.push(...namedParams);
	return result.join(";");
};

// ---------------------------------------------------------------------------
// QP soft-line-break joining
// ---------------------------------------------------------------------------

/**
 * Join QUOTED-PRINTABLE soft-wrapped lines in place.
 *
 * vCard 2.1 uses `=\r\n` (or `=\n`) as a QP continuation marker *inside* a
 * property value. This differs from the normal CRLF+WSP folding; it must be
 * handled *before* the content-line layer processes the text.
 *
 * We scan for lines that (a) end with `=` and (b) belong to a property that
 * has `ENCODING=QUOTED-PRINTABLE` or `ENCODING=QP` in its parameter section.
 */
const joinQpLines = (lines: Array<string>): Array<string> => {
	const result: Array<string> = [];
	let i = 0;
	while (i < lines.length) {
		let line = lines[i] ?? "";
		// Check if this line has QP encoding — look for ENCODING= in the part
		// before the first unquoted colon.
		const colonIdx = line.indexOf(":");
		const paramPart = colonIdx !== -1 ? line.slice(0, colonIdx) : line;
		const isQp = /ENCODING\s*=\s*(QUOTED-PRINTABLE|QP)/i.test(paramPart);

		if (isQp) {
			// Consume continuation lines while the current accumulated line ends with =
			while (line.endsWith("=") && i + 1 < lines.length) {
				// Remove the trailing = (soft break)
				line = line.slice(0, -1);
				i++;
				const next = (lines[i] ?? "").trimStart(); // remove leading WSP
				line += next;
			}
			// Decode QP value: find the colon separator, decode only the value part
			const splitIdx = line.indexOf(":");
			if (splitIdx !== -1) {
				const propPart = line.slice(0, splitIdx);
				const valuePart = line.slice(splitIdx + 1);
				line = `${propPart}:${decodeQp(valuePart)}`;
			}
		}
		result.push(line);
		i++;
	}
	return result;
};

// ---------------------------------------------------------------------------
// Line-level parameter normalization
// ---------------------------------------------------------------------------

/**
 * Normalize bare parameters on a single physical line.
 *
 * Lines with bare params look like: `TEL;WORK;VOICE:+1-555-5555`
 * We need to rewrite the section between the property name and the `:`.
 */
const normalizeLine = (line: string): string => {
	// Find the first unquoted colon — that's the name/param boundary
	let inQuote = false;
	let colonIdx = -1;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') { inQuote = !inQuote; }
		else if (ch === ":" && !inQuote) { colonIdx = i; break; }
	}
	if (colonIdx === -1) { return line; }

	const nameAndParams = line.slice(0, colonIdx);
	const value = line.slice(colonIdx + 1);

	// Split nameAndParams at the first ";" to get property name vs param block
	const firstSemicolon = nameAndParams.indexOf(";");
	if (firstSemicolon === -1) { return line; } // no params → nothing to normalize

	const propName = nameAndParams.slice(0, firstSemicolon);
	const rawParams = nameAndParams.slice(firstSemicolon + 1);

	// Check for any bare params (segments without "=")
	const segments = rawParams.split(";");
	const hasBareParam = segments.some((s) => s.length > 0 && !s.includes("="));
	if (!hasBareParam) { return line; }

	const normalized = normalizeParamSection(rawParams);
	return normalized
		? `${propName};${normalized}:${value}`
		: `${propName}:${value}`;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize vCard 2.1 text to vCard 3.0/4.0-compatible syntax.
 *
 * Steps:
 *   1. Split on line boundaries (CRLF or LF)
 *   2. Join QUOTED-PRINTABLE soft-wrapped lines and decode QP values
 *   3. Normalize bare parameters to explicit `TYPE=` / `PREF=` form
 *
 * The caller should invoke this before passing text to the vCard codec.
 * CRLF normalization and standard folding unfold are handled by ContentLinesCodec.
 */
export const normalizeVCard21 = (text: string): string => {
	// Split preserving CRLF vs LF structure (we'll rejoin with CRLF)
	const lines = text.split(/\r?\n/);
	const qpJoined = joinQpLines(lines);
	const normalized = qpJoined.map(normalizeLine);
	return normalized.join("\r\n");
};
