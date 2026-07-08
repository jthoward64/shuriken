import type { Config } from "effect";
import type { SecurityHeadersConfig } from "#src/config.ts";

type SecurityHeadersConfigType = Config.Success<typeof SecurityHeadersConfig>;

// ---------------------------------------------------------------------------
// applySecurityHeaders — the single point every response passes through
// before leaving handleRequest (see router.ts), covering DAV, UI, feed, and
// embed responses uniformly. Modeled on mapErrorToResponse's role as the
// existing precedent for "one function transforms the final Response
// regardless of which branch produced it".
//
// frame-ancestors is path-differentiated:
//   * /ui/embed/*  — 'self' plus the configured allowlist (authenticated
//                    panes, operator-controlled iframing).
//   * /embed/*     — no restriction at all: anyone holding a share-link
//                    token can already fetch the data (same trust model as
//                    the .ics feed), so the widget doesn't second-guess who
//                    else may iframe it.
//   * everything else — 'none' (deny framing outright).
// ---------------------------------------------------------------------------

const isEmbedPanePath = (pathname: string): boolean =>
	pathname.startsWith("/ui/embed/");

const isPublicEmbedPath = (pathname: string): boolean =>
	pathname.startsWith("/embed/");

const buildCsp = (cfg: SecurityHeadersConfigType, pathname: string): string => {
	const directives = [
		"default-src 'self'",
		"script-src 'self'",
		// style-src is the fallback for browsers that don't support the
		// style-src-elem/style-src-attr split (falls back to 'self', slightly
		// stricter than style-src-attr alone but not a regression from before).
		// style-src-elem stays locked to 'self' — no <style>/<link> injection.
		// style-src-attr allows 'unsafe-inline' narrowly: FullCalendar sets an
		// inline `style="--fc-event-color:...` per event for per-calendar
		// colors, with no nonce mechanism available (verified against the
		// package source) — this can't inject stylesheets or run JS, just lets
		// elements carry inline custom-property values.
		"style-src 'self'",
		"style-src-elem 'self'",
		"style-src-attr 'unsafe-inline'",
		"img-src 'self' data:",
		"connect-src 'self'",
		"base-uri 'self'",
		"form-action 'self'",
	];
	if (isPublicEmbedPath(pathname)) {
		// No frame-ancestors directive at all — deliberately unrestricted.
	} else if (isEmbedPanePath(pathname)) {
		directives.push(
			`frame-ancestors 'self' ${cfg.frameAncestors.join(" ")}`.trimEnd(),
		);
	} else {
		directives.push("frame-ancestors 'none'");
	}
	return directives.join("; ");
};

/** Returns a new Response with security headers applied — never mutates
 * `response` in place, since its Headers may back an already-constructed
 * Response from an earlier layer. */
export const applySecurityHeaders = (
	response: Response,
	cfg: SecurityHeadersConfigType,
	pathname: string,
	isHttps: boolean,
): Response => {
	if (!cfg.enabled) {
		return response;
	}
	const headers = new Headers(response.headers);
	if (cfg.cspEnabled) {
		headers.set("Content-Security-Policy", buildCsp(cfg, pathname));
	}
	if (cfg.xContentTypeOptionsEnabled) {
		headers.set("X-Content-Type-Options", "nosniff");
	}
	if (cfg.referrerPolicyEnabled) {
		headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	}
	if (cfg.hstsEnabled && isHttps) {
		headers.set(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains",
		);
	}
	if (cfg.permissionsPolicyEnabled) {
		headers.set(
			"Permissions-Policy",
			"geolocation=(), camera=(), microphone=()",
		);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
};
