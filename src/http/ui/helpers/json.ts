import { Option, Schema } from "effect";

// ---------------------------------------------------------------------------
// JSON serialization boundary for the UI edge
//
// Everything the UI writes as JSON (fetch payloads, `data-*` attributes read by
// the browser scripts, SSE frames, cache fingerprints) goes through this one
// codec rather than scattering raw JSON calls across handlers and views.
// ---------------------------------------------------------------------------

/** Encodes a value as a JSON string */
export const encodeJson = Schema.encodeUnknownSync(
	Schema.UnknownFromJsonString,
);

/** Decodes a JSON string, or none when the text is not valid JSON */
export const decodeJson = Option.liftThrowable(
	Schema.decodeUnknownSync(Schema.UnknownFromJsonString),
);
