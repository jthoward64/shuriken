/**
 * Percent-encode a single URL path segment for safe inclusion in a response
 * href or Location header.
 *
 * Path segments are stored/compared in their decoded form (parseDavPath runs
 * `decodeURIComponent` on every segment), so when a stored slug — which may now
 * contain characters like `@` that clients use in UID-derived object names — is
 * interpolated back into a URL, it must be re-encoded. `encodeURIComponent`
 * encodes everything outside the unreserved set plus a handful of sub-delims
 * (`!~*'()`), which is exactly correct for a single path segment: reserved
 * delimiters (`/ ? # @ & = + ; , : $`) and unsafe characters (space, control)
 * become percent-escapes, so the segment can never break out into the path,
 * query, or authority.
 *
 * Note on XML: response bodies are serialized by fast-xml-builder, which
 * XML-escapes text content automatically, so callers do not additionally escape
 * `&`/`<`/`>` here — and after percent-encoding an href contains none of them
 * anyway.
 */
export const encodeSegment = (segment: string): string =>
	encodeURIComponent(segment);
