import { type Effect, FiberRef, Option } from "effect";
import type { SmtpSecurity } from "#src/db/drizzle/schema/index.ts";

// ---------------------------------------------------------------------------
// Per-request SMTP creds injected by a trusted reverse proxy.
//
// When the proxy headers configured via `mail.proxyUsernameHeader` /
// `mail.proxyPasswordHeader` are present on a request from a trusted IP,
// the router sets this FiberRef to a SmtpProxyOverride. The
// EmailCredentialService resolver reads it first and short-circuits the
// usual stored / profile / default chain, so the request sends mail with
// the proxy-supplied credentials.
//
// Lives at the HTTP layer (not in the service module) because only the
// HTTP edge sees the raw request headers and the trusted-proxy IP.
// ---------------------------------------------------------------------------

export interface SmtpProxyOverride {
	readonly username: string;
	readonly password: string;
	readonly host: Option.Option<string>;
	readonly port: Option.Option<number>;
	readonly security: Option.Option<SmtpSecurity>;
}

export const SmtpProxyOverrideRef = FiberRef.unsafeMake<
	Option.Option<SmtpProxyOverride>
>(Option.none());

export const getSmtpProxyOverride: Effect.Effect<
	Option.Option<SmtpProxyOverride>
> = FiberRef.get(SmtpProxyOverrideRef);

export const setSmtpProxyOverride = (
	override: SmtpProxyOverride,
): Effect.Effect<void> =>
	FiberRef.set(SmtpProxyOverrideRef, Option.some(override));
