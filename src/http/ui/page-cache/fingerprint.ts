import type { Effect } from "effect";
import type { InternalError } from "#src/domain/errors.ts";
import { HTTP_NOT_MODIFIED } from "#src/http/status.ts";
import { strongEtag } from "#src/http/ui/asset-etag.ts";

// ---------------------------------------------------------------------------
// Page-level conditional GET for expensive rendered pages (calendar, contacts,
// tasks). Callers build a fingerprint from every cheap signal that would
// change the rendered HTML (collection ids/synctoken/updatedAt/sortOrder,
// relevant query params, HTMX fragment-mode, etc.) *before* running their
// expensive per-instance queries, so a match skips that work entirely rather
// than only skipping the HTML transfer.
//
// Pages are per-principal and dynamic, so the response must always revalidate
// rather than being reused opportunistically — see PAGE_CACHE_CONTROL.
// ---------------------------------------------------------------------------

/** Responses are per-principal and change whenever the caller's own data
 * does, so any cache must revalidate on every use (`no-cache`); still cheaper
 * than a full re-render since a match costs one 304, not a re-transfer. */
export const PAGE_CACHE_CONTROL = "private, no-cache";

/** Strong ETag over the startup token plus arbitrary JSON-serializable
 * fingerprint parts. The startup token guarantees a deploy/restart
 * invalidates every previously-issued page ETag, regardless of whether the
 * fingerprint's inputs fully capture what changed in that release. */
export const pageEtag = (
	startupToken: string,
	parts: unknown,
): Effect.Effect<string, InternalError> =>
	strongEtag(`${startupToken}|${JSON.stringify(parts)}`);

/** 304 short-circuit for a conditional GET against a page fingerprint; returns
 * `undefined` when the page must be (re)rendered. */
export const notModifiedPageResponse = (
	headers: Headers,
	etag: string,
): Response | undefined => {
	if (headers.get("if-none-match") !== etag) {
		return undefined;
	}
	return new Response(null, {
		status: HTTP_NOT_MODIFIED,
		headers: { ETag: etag, "Cache-Control": PAGE_CACHE_CONTROL },
	});
};

/** Stamps the ETag + Cache-Control used for the conditional-GET check onto the
 * freshly-rendered 200 response, so the client has a validator to send back
 * next time. */
export const withPageCacheHeaders = (
	response: Response,
	etag: string,
): Response => {
	response.headers.set("ETag", etag);
	response.headers.set("Cache-Control", PAGE_CACHE_CONTROL);
	return response;
};
