import { Effect } from "effect";
import { XMLParser } from "fast-xml-parser";
import { type DavError, XmlParseError, davError } from "#src/domain/errors.ts";
import { HTTP_REQUEST_ENTITY_TOO_LARGE } from "#src/http/status.ts";

// Maximum size in bytes accepted for XML request bodies (PROPFIND, PROPPATCH, REPORT).
// Rejects payloads larger than this with 413 before parsing.
const MAX_XML_BODY_BYTES = 524_288; // 512 KiB

// ---------------------------------------------------------------------------
// Effect-wrapped XML parser
//
// Pure functions — not an Effect.Service.  DAV handlers import directly.
// ---------------------------------------------------------------------------

// Note: fast-xml-parser does not expose a maxDepth option. Depth limiting is
// handled at the body-size level via readXmlBody (512 KiB cap). A deeply
// nested DAV payload that fits within that limit is accepted; this is an
// acceptable trade-off given DAV XML structures are shallow in practice.
const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	allowBooleanAttributes: true,
	parseTagValue: false, // Keep all values as strings; callers parse as needed
	trimValues: true,
});

/**
 * Read and size-check the XML body of a DAV request.
 * Rejects with 413 if the body exceeds MAX_XML_BODY_BYTES before parsing.
 * Handlers should call this instead of `req.text()` directly.
 *
 * Note: the size check uses character count, not UTF-8 byte count. For
 * XML bodies that are overwhelmingly ASCII (as DAV XML is), this is a safe
 * approximation — a multi-byte character is at least one character, so the
 * check may accept slightly more than 512 KiB of raw bytes, but never less.
 */
export const readXmlBody = (req: Request): Effect.Effect<string, DavError> =>
	Effect.tryPromise({
		try: () => req.text(),
		catch: (e) => davError(HTTP_REQUEST_ENTITY_TOO_LARGE, undefined, String(e)),
	}).pipe(
		Effect.flatMap((text) =>
			text.length > MAX_XML_BODY_BYTES
				? Effect.fail(davError(HTTP_REQUEST_ENTITY_TOO_LARGE))
				: Effect.succeed(text),
		),
	);

/**
 * Parse an XML string into an unknown object tree.
 * The caller is responsible for validating the shape of the result.
 */
export const parseXml = (body: string): Effect.Effect<unknown, XmlParseError> =>
	Effect.try({
		try: () => parser.parse(body) as unknown,
		catch: (e) => new XmlParseError({ cause: e }),
	});
