import type { IrParameter, IrProperty, IrValue } from "../ir.ts";
import { baseName, getTypeTokens } from "./prop.ts";

// ---------------------------------------------------------------------------
// Inline binary media across vCard versions (RFC 6350 §A.2).
//
// 2.1/3.0 carry an embedded image as raw base64 in the value with the encoding
// named in a parameter, and the image format in a TYPE token (2.1's bare
// `PHOTO;ENCODING=BASE64;JPEG:` is normalised to `TYPE=JPEG` by vcard21.ts):
//
//   PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRg...
//
// 4.0 has no ENCODING parameter — the same bytes ride in a `data:` URI, which
// carries the media type itself:
//
//   PHOTO:data:image/jpeg;base64,/9j/4AAQSkZJRg...
//
// Upgrade folds the parameters into a data: URI so stored 4.0 cards hold a
// value everything downstream (the /photo endpoint, <img src>, the editor's
// URL input) can already consume; downgrade unfolds it again for 3.0 clients.
// ---------------------------------------------------------------------------

/** Properties whose value may be inline base64 image data. */
const INLINE_IMAGE_PROPS: ReadonlySet<string> = new Set(["PHOTO", "LOGO"]);

const DEFAULT_IMAGE_MIME = "image/jpeg";

// Legacy TYPE format token ↔ media type. Keyed by the uppercase token as it
// appears on the wire; the reverse direction prefers the first token listed for
// a given media type.
const FORMAT_TOKEN_MIME: ReadonlyArray<readonly [string, string]> = [
	["JPEG", "image/jpeg"],
	["JPG", "image/jpeg"],
	["PNG", "image/png"],
	["GIF", "image/gif"],
	["WEBP", "image/webp"],
	["TIFF", "image/tiff"],
	["TIF", "image/tiff"],
	["BMP", "image/bmp"],
	["HEIC", "image/heic"],
	["HEIF", "image/heif"],
	["AVIF", "image/avif"],
	["SVG", "image/svg+xml"],
	["ICO", "image/x-icon"],
];

const MIME_FOR_TOKEN: ReadonlyMap<string, string> = new Map(FORMAT_TOKEN_MIME);

const TOKEN_FOR_MIME: ReadonlyMap<string, string> = new Map(
	// Later duplicates would overwrite the canonical token, so reverse first.
	[...FORMAT_TOKEN_MIME].reverse().map(([token, mime]) => [mime, token]),
);

/** True when a parameter marks the value as base64 (`ENCODING=b` / `=BASE64`). */
const isBase64Param = (p: IrParameter): boolean => {
	if (p.name.toUpperCase() !== "ENCODING") {
		return false;
	}
	const v = p.value.toUpperCase();
	return v === "B" || v === "BASE64";
};

/** String payload of the string-typed IrValue variants; "" otherwise. */
const rawStr = (value: IrValue): string =>
	typeof value.value === "string" ? value.value : "";

/**
 * Media type for a legacy inline image: an explicit `MEDIATYPE=` wins, then a
 * recognised format TYPE token, else JPEG (overwhelmingly the common case, and
 * what browsers sniff past anyway).
 */
const legacyMediaType = (prop: IrProperty): string => {
	const mediatype = prop.parameters.find(
		(p) => p.name.toUpperCase() === "MEDIATYPE",
	);
	if (mediatype !== undefined && mediatype.value !== "") {
		return mediatype.value;
	}
	for (const token of getTypeTokens(prop)) {
		const mime = MIME_FOR_TOKEN.get(token.toUpperCase());
		if (mime !== undefined) {
			return mime;
		}
	}
	return DEFAULT_IMAGE_MIME;
};

/** TYPE tokens minus any image-format token (which the data: URI now carries). */
const nonFormatTypeTokens = (prop: IrProperty): ReadonlyArray<string> =>
	getTypeTokens(prop).filter((t) => !MIME_FOR_TOKEN.has(t.toUpperCase()));

/**
 * 2.1/3.0 inline base64 → a 4.0 `data:` URI. Properties without an `ENCODING`
 * base64 parameter, and non-image properties, are returned untouched.
 */
export const upgradeInlineMedia = (prop: IrProperty): IrProperty => {
	if (!INLINE_IMAGE_PROPS.has(baseName(prop.name))) {
		return prop;
	}
	if (!prop.parameters.some(isBase64Param)) {
		return prop;
	}
	// Whitespace can survive folding/continuation lines in hand-written 2.1.
	const payload = rawStr(prop.value).replace(/\s+/g, "");
	if (payload === "") {
		return prop;
	}
	const mime = legacyMediaType(prop);
	const tokens = nonFormatTypeTokens(prop);
	return {
		...prop,
		parameters: [
			...prop.parameters.filter(
				(p) =>
					!isBase64Param(p) &&
					p.name.toUpperCase() !== "TYPE" &&
					p.name.toUpperCase() !== "MEDIATYPE",
			),
			...(tokens.length > 0 ? [{ name: "TYPE", value: tokens.join(",") }] : []),
		],
		value: { type: "URI", value: `data:${mime};base64,${payload}` },
		isKnown: true,
	};
};

/** Matches a base64 `data:` URI, capturing its media type and payload. */
const DATA_URI_BASE64 = /^data:([^;,]*);base64,(.*)$/s;

/**
 * A 4.0 base64 `data:` URI → 3.0 `ENCODING=b` with the format as a TYPE token.
 * Non-base64 data URIs (percent-encoded) and remote URLs pass through — 3.0 has
 * no better representation for them than the URI itself.
 */
export const downgradeInlineMedia = (prop: IrProperty): IrProperty => {
	if (!INLINE_IMAGE_PROPS.has(baseName(prop.name))) {
		return prop;
	}
	const match = DATA_URI_BASE64.exec(rawStr(prop.value));
	if (match === null) {
		return prop;
	}
	const mime = match[1] ?? "";
	const payload = match[2] ?? "";
	const token = TOKEN_FOR_MIME.get(mime.toLowerCase());
	const tokens = [...nonFormatTypeTokens(prop), ...(token ? [token] : [])];
	return {
		...prop,
		parameters: [
			...prop.parameters.filter(
				(p) =>
					p.name.toUpperCase() !== "TYPE" &&
					p.name.toUpperCase() !== "ENCODING" &&
					p.name.toUpperCase() !== "MEDIATYPE",
			),
			{ name: "ENCODING", value: "b" },
			...(tokens.length > 0 ? [{ name: "TYPE", value: tokens.join(",") }] : []),
		],
		// isKnown:false → the codec emits the base64 payload verbatim rather than
		// escaping it as TEXT.
		value: { type: "TEXT", value: payload },
		isKnown: false,
	};
};
