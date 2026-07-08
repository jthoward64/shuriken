// ---------------------------------------------------------------------------
// HTMX request detection
// ---------------------------------------------------------------------------

export const isHtmxRequest = (headers: Headers): boolean =>
	headers.get("HX-Request") === "true";
