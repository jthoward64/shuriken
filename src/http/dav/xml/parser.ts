import { Effect } from "effect";
import { XMLParser } from "fast-xml-parser";
import type { XmlParseError } from "#src/domain/errors.ts";
import { xmlParseError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// Effect-wrapped XML parser
//
// Pure functions — not an Effect.Service.  DAV handlers import directly.
// ---------------------------------------------------------------------------

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	allowBooleanAttributes: true,
	parseTagValue: false, // Keep all values as strings; callers parse as needed
	trimValues: true,
});

/**
 * Parse an XML string into an unknown object tree.
 * The caller is responsible for validating the shape of the result.
 */
export const parseXml = (body: string): Effect.Effect<unknown, XmlParseError> =>
	Effect.try({
		try: () => parser.parse(body) as unknown,
		catch: (e) => xmlParseError(e),
	});
