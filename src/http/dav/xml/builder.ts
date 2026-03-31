import Builder from "fast-xml-builder";
import type { XMLBuilder } from "fast-xml-builder";
import { Effect } from "effect";

// ---------------------------------------------------------------------------
// Effect-wrapped XML builder
//
// Pure functions — not an Effect.Service.  DAV handlers import directly.
// ---------------------------------------------------------------------------

const builder: XMLBuilder = new Builder({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	format: false, // Compact output for wire format
	suppressEmptyNode: true,
});

/** Serialise an object tree to an XML string. */
export const buildXml = (obj: unknown): Effect.Effect<string, never> =>
	Effect.sync(() => builder.build(obj) as string);
