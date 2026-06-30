import { Option } from "effect";

// ---------------------------------------------------------------------------
// Cookie helpers — request parsing and Set-Cookie construction.
//
// Transport-neutral string helpers used by the UI edge to read the session
// cookie and to emit it. Kept out of business logic; handlers return values and
// the edge attaches the header.
// ---------------------------------------------------------------------------

/** Name of the browser-session cookie. */
export const SESSION_COOKIE = "shuriken_session";

/** Parse a `Cookie:` header into a name→value map (first wins on duplicates). */
const parseCookieHeader = (header: string): Map<string, string> => {
	const out = new Map<string, string>();
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) {
			continue;
		}
		const name = part.slice(0, eq).trim();
		if (name.length === 0 || out.has(name)) {
			continue;
		}
		out.set(name, part.slice(eq + 1).trim());
	}
	return out;
};

/** Read a single cookie value from the request headers. */
export const getCookie = (
	headers: Headers,
	name: string,
): Option.Option<string> => {
	const header = headers.get("cookie");
	if (header === null) {
		return Option.none();
	}
	const value = parseCookieHeader(header).get(name);
	return value === undefined || value.length === 0
		? Option.none()
		: Option.some(value);
};

export interface CookieOptions {
	readonly maxAgeSeconds?: number;
	readonly secure: boolean;
	readonly httpOnly?: boolean;
	readonly sameSite?: "Lax" | "Strict" | "None";
	readonly path?: string;
}

/** Serialize a `Set-Cookie` header value. */
export const serializeCookie = (
	name: string,
	value: string,
	options: CookieOptions,
): string => {
	const parts = [`${name}=${value}`];
	parts.push(`Path=${options.path ?? "/"}`);
	parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
	if (options.httpOnly !== false) {
		parts.push("HttpOnly");
	}
	if (options.secure) {
		parts.push("Secure");
	}
	if (options.maxAgeSeconds !== undefined) {
		parts.push(`Max-Age=${Math.trunc(options.maxAgeSeconds)}`);
	}
	return parts.join("; ");
};

/** Build the `Set-Cookie` that clears the session cookie (logout). */
export const clearSessionCookie = (secure: boolean): string =>
	serializeCookie(SESSION_COOKIE, "", { secure, maxAgeSeconds: 0 });
