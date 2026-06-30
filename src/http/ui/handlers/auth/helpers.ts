import { Option } from "effect";
import type { AppConfigType } from "#src/config.ts";

// ---------------------------------------------------------------------------
// Shared helpers for the OIDC web-login routes.
// ---------------------------------------------------------------------------

/**
 * The OIDC callback URL. Uses OIDC_REDIRECT_URI when configured, otherwise
 * derives it from the request's public origin so a single-host deployment needs
 * no extra configuration.
 */
export const oidcRedirectUri = (origin: string, cfg: AppConfigType): string =>
	Option.getOrElse(
		cfg.auth.oidcRedirectUri,
		() => `${origin}/ui/auth/callback`,
	);

/**
 * Constrain a `returnTo` value to a same-site absolute path so it can't be used
 * as an open-redirect. Rejects protocol-relative (`//host`) and absolute URLs.
 */
export const sanitizeReturnTo = (raw: string | null): string =>
	raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/ui";

/** Whether cookies for this request should carry the Secure attribute. */
export const isSecureRequest = (url: URL): boolean => url.protocol === "https:";
