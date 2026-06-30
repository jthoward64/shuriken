import type { Option } from "effect";
import { isClientTrusted } from "#src/http/trusted-proxy.ts";

// ---------------------------------------------------------------------------
// Externally-visible request URL resolution
//
// Behind a TLS-terminating reverse proxy, `Deno.serve` only sees the internal
// plaintext hop, so `req.url` carries `http:` and (potentially) the internal
// host. DAV clients compare the `<href>`s we emit against the URL they actually
// requested, so every absolute URL must reflect the *public* scheme/host. We
// reconstruct it from the proxy's `X-Forwarded-Proto` / `X-Forwarded-Host`
// headers — but only when the request comes from a trusted proxy IP (the same
// trust model as proxy auth), otherwise an untrusted client could forge hrefs.
// ---------------------------------------------------------------------------

/** First comma-separated token, trimmed; `undefined` when absent/empty. */
const firstToken = (value: string | null): string | undefined => {
	if (value === null) {
		return undefined;
	}
	const first = value.split(",")[0]?.trim();
	return first === undefined || first.length === 0 ? undefined : first;
};

/**
 * Return the URL as seen by the external client. When the request arrives from
 * a trusted proxy, `X-Forwarded-Proto` overrides the scheme and
 * `X-Forwarded-Host` overrides the authority; otherwise `rawUrl` is returned
 * unchanged. The pathname/search are always preserved.
 */
export const resolveForwardedUrl = (
	rawUrl: URL,
	headers: Headers,
	clientIp: Option.Option<string>,
	trustedProxies: string,
): URL => {
	if (!isClientTrusted(clientIp, trustedProxies)) {
		return rawUrl;
	}

	const url = new URL(rawUrl);

	const proto = firstToken(headers.get("x-forwarded-proto"));
	if (proto === "http" || proto === "https") {
		url.protocol = `${proto}:`;
	}

	const host = firstToken(headers.get("x-forwarded-host"));
	if (host !== undefined) {
		// Parse via a throwaway URL so IPv6 literals and optional ports are handled
		// correctly (the `host` setter retains the inherited port when the value
		// omits one). `URL.parse` returns null rather than throwing on bad input.
		const parsed = URL.parse(`http://${host}`);
		if (parsed !== null) {
			url.hostname = parsed.hostname;
			url.port = parsed.port;
		}
	}

	return url;
};
