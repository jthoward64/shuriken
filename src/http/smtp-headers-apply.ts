import { Effect, Option } from "effect";
import { isClientTrusted } from "#src/auth/layers/proxy.ts";
import type { AppConfigType } from "#src/config.ts";
import type { SmtpSecurity } from "#src/db/drizzle/schema/index.ts";
import { setSmtpProxyOverride } from "#src/http/smtp-headers-ref.ts";

// ---------------------------------------------------------------------------
// applySmtpProxyHeaders — set the SMTP override FiberRef when the request
// arrives from a trusted proxy with both the username and password headers
// populated. Optional host/port/security headers are picked up if present;
// otherwise the resolver falls back to the default SMTP profile values.
// ---------------------------------------------------------------------------

const VALID_SECURITY = new Set<SmtpSecurity>(["none", "starttls", "tls"]);
const MAX_PORT = 65536;

const parseSecurity = (raw: string): Option.Option<SmtpSecurity> => {
	const v = raw.trim().toLowerCase() as SmtpSecurity;
	return VALID_SECURITY.has(v) ? Option.some(v) : Option.none();
};

const parsePort = (raw: string): Option.Option<number> => {
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 && n < MAX_PORT
		? Option.some(n)
		: Option.none();
};

const headerValue = (
	headers: Headers,
	name: Option.Option<string>,
): Option.Option<string> =>
	Option.flatMap(name, (n) => {
		const raw = headers.get(n);
		return raw === null || raw === "" ? Option.none() : Option.some(raw);
	});

export const applySmtpProxyHeaders = (
	headers: Headers,
	clientIp: Option.Option<string>,
	cfg: AppConfigType,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		const { mail, auth } = cfg;
		if (
			Option.isNone(mail.proxyUsernameHeader) ||
			Option.isNone(mail.proxyPasswordHeader)
		) {
			return;
		}
		if (!isClientTrusted(clientIp, auth.trustedProxies)) {
			return;
		}
		const usernameOpt = headerValue(headers, mail.proxyUsernameHeader);
		const passwordOpt = headerValue(headers, mail.proxyPasswordHeader);
		if (Option.isNone(usernameOpt) || Option.isNone(passwordOpt)) {
			return;
		}
		const hostOpt = headerValue(headers, mail.proxyHostHeader);
		const portRawOpt = headerValue(headers, mail.proxyPortHeader);
		const portOpt = Option.flatMap(portRawOpt, parsePort);
		const securityRawOpt = headerValue(headers, mail.proxySecurityHeader);
		const securityOpt = Option.flatMap(securityRawOpt, parseSecurity);

		yield* setSmtpProxyOverride({
			username: usernameOpt.value,
			password: passwordOpt.value,
			host: hostOpt,
			port: portOpt,
			security: securityOpt,
		});
	});
