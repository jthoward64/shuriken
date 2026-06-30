import {
	Config,
	ConfigProvider,
	Context,
	Effect,
	Layer,
	LogLevel,
} from "effect";

// ---------------------------------------------------------------------------
// Application configuration — all env vars read through Effect's Config API.
// The `deno task` definitions pass `--env-file=.env`, so Deno loads .env into
// the environment before the program starts.
//
// AppConfigService is the single source of truth for runtime configuration.
// All services that need configuration must depend on this service rather
// than reading env vars directly. No code outside this file should call
// Config.string/integer/etc. for application config.
//
// Config keys are written in camelCase here; ConfigProvider.constantCase
// maps them to SCREAMING_SNAKE_CASE env vars automatically (e.g. "databaseUrl"
// resolves DATABASE_URL). The constantCase provider is baked into
// AppConfigService so it applies in all contexts including tests.
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 3000;

export const ServerConfig = Config.all({
	port: Config.int("port").pipe(Config.withDefault(DEFAULT_PORT)),
	host: Config.string("host").pipe(Config.withDefault("::")),
});

const DEFAULT_METRICS_PORT = 9464;

export const MetricsConfig = Config.all({
	/**
	 * Exposes the Prometheus `/metrics` endpoint on a dedicated listener
	 * (`metricsPort`). Kept off the main HTTP port so the endpoint is never
	 * reachable through a public ingress; scrape it in-cluster instead.
	 * Defaults to enabled.
	 */
	enabled: Config.boolean("metricsEnabled").pipe(Config.withDefault(true)),
	/**
	 * Port for the metrics listener. 9464 is the OpenTelemetry/Prometheus
	 * exporter convention. Bound to the same host as the main server.
	 */
	port: Config.int("metricsPort").pipe(
		Config.withDefault(DEFAULT_METRICS_PORT),
	),
});

export const DatabaseConfig = Config.all({
	url: Config.redacted("databaseUrl"),
});

const DEFAULT_SESSION_TTL_DAYS = 7;

export const AuthConfig = Config.all({
	/**
	 * Auto-login email. When set, all requests are authenticated as this user
	 * without credential checks. Use for development or single-user self-hosted
	 * setups. Takes precedence over both proxy and basic auth.
	 */
	autoLogin: Config.string("autoLogin").pipe(Config.option),

	/**
	 * Comma-separated list of trusted proxy IPs, or "*" to trust all.
	 * Requests from untrusted IPs have their `X-Forwarded-*` headers (public
	 * scheme/host reconstruction) and SMTP credential override headers ignored.
	 */
	trustedProxies: Config.string("trustedProxies").pipe(Config.withDefault("*")),

	/**
	 * HTTP Basic Authentication toggle. Defaults to true; set BASIC_AUTH_ENABLED=false
	 * to disable. When enabled, the server validates Authorization: Basic headers
	 * against the auth_user table and emits WWW-Authenticate on 401.
	 */
	basicAuthEnabled: Config.boolean("basicAuthEnabled").pipe(
		Config.withDefault(true),
	),

	/**
	 * Email of the admin user provisioned for basic auth on first boot.
	 * Optional; only used when basic auth is enabled.
	 */
	adminEmail: Config.string("adminEmail").pipe(Config.option),

	/** Password for the default admin user. If absent a random password is generated and printed to stdout on first run. */
	adminPassword: Config.redacted("adminPassword").pipe(Config.option),

	/** Slug for the default admin user. Defaults to the local part of ADMIN_EMAIL. */
	adminSlug: Config.string("adminSlug").pipe(Config.option),

	/**
	 * External account-management URL shown on the user's profile page.
	 *
	 * Typical use: when the server runs behind an SSO portal (Authelia,
	 * Authentik, Keycloak, ...), password changes and profile edits happen
	 * over there rather than in this app. Set this to a URL with optional
	 * `{email}`, `{slug}`, or `{userId}` placeholders and the profile page
	 * surfaces a link with the substitutions filled in.
	 *
	 * Example: `https://sso.example.com/account?username={email}`.
	 */
	authSettingsUrl: Config.string("authSettingsUrl").pipe(Config.option),

	/** Link text for the external auth-settings link. Defaults to "Manage account". */
	authSettingsLabel: Config.string("authSettingsLabel").pipe(Config.option),

	/**
	 * OpenID Connect login for the web UI. When enabled, the UI offers an
	 * authorization-code (PKCE) login against the configured provider and
	 * issues a server-side session cookie. DAV clients are unaffected — they
	 * keep using Basic auth (local password or an app password).
	 */
	oidcEnabled: Config.boolean("oidcEnabled").pipe(Config.withDefault(false)),

	/** Issuer URL used for OIDC discovery (`<issuer>/.well-known/openid-configuration`). */
	oidcIssuer: Config.string("oidcIssuer").pipe(Config.option),

	/** OIDC client id registered with the provider. */
	oidcClientId: Config.string("oidcClientId").pipe(Config.option),

	/** OIDC client secret. Omit for a public client using PKCE only. */
	oidcClientSecret: Config.redacted("oidcClientSecret").pipe(Config.option),

	/**
	 * Full callback URL registered with the provider. When unset it is derived
	 * from the request's public origin plus `/ui/auth/callback`.
	 */
	oidcRedirectUri: Config.string("oidcRedirectUri").pipe(Config.option),

	/** Space-separated OIDC scopes. Defaults to "openid profile email". */
	oidcScopes: Config.string("oidcScopes").pipe(
		Config.withDefault("openid profile email"),
	),

	/**
	 * When true (default), a successful OIDC login for an unknown identity
	 * provisions a new user from the token's email/name claims. Set false to
	 * require an admin to pre-create the user first.
	 */
	oidcAutoProvision: Config.boolean("oidcAutoProvision").pipe(
		Config.withDefault(true),
	),

	/** Browser session lifetime in days (absolute, from login). Defaults to 7. */
	sessionTtlDays: Config.int("sessionTtlDays").pipe(
		Config.withDefault(DEFAULT_SESSION_TTL_DAYS),
	),
});

// Accept log-level names case-insensitively. Effect's Config.logLevel only
// matches its canonical capitalized labels ("Info"), but the Helm chart and the
// wider ecosystem use lowercase ("info"); normalize before matching so either
// works. An unrecognized value resolves to no override — the logger keeps its
// default minimum level rather than crashing config loading.
const logLevel = Config.string("logLevel").pipe(
	Config.map((raw) =>
		LogLevel.values.find(
			(level) => level.toLowerCase() === raw.trim().toLowerCase(),
		),
	),
);

export const LogConfig = Config.all({
	level: logLevel.pipe(Config.withDefault(undefined)),
});

const DEFAULT_EXTERNAL_TICK_S = 60;
const DEFAULT_EXTERNAL_CONCURRENCY = 4;
const DEFAULT_EXTERNAL_CLAIM_CAP = 100;
const DEFAULT_BIRTHDAY_TICK_S = 600;
const DEFAULT_BIRTHDAY_CONCURRENCY = 4;

export const ExternalCalendarConfig = Config.all({
	/**
	 * How often the background scheduler wakes up to look for due external
	 * calendars. The actual sync cadence per URL is governed by each row's
	 * `sync_interval_s`; this just bounds how *quickly* a newly-due row gets
	 * picked up. 60s is a good default — small enough that adding a new
	 * subscription shows events within a minute, large enough not to thrash
	 * the DB when no work is pending.
	 */
	schedulerTickS: Config.int("externalCalendarSchedulerTickS").pipe(
		Config.withDefault(DEFAULT_EXTERNAL_TICK_S),
	),
	/**
	 * Maximum number of URLs the scheduler will fetch in parallel per tick.
	 * Each one is an outbound HTTP call + DB transaction per claim, so 4
	 * gives reasonable throughput without overloading slow upstreams.
	 */
	fetchConcurrency: Config.int("externalCalendarFetchConcurrency").pipe(
		Config.withDefault(DEFAULT_EXTERNAL_CONCURRENCY),
	),
	/**
	 * Soft DoS guard on claims-per-URL. New claim requests beyond this cap
	 * are rejected by the create endpoint. Per-tenant deployments can leave
	 * this generous; public-facing multi-tenant deployments may want it
	 * lower.
	 */
	claimCap: Config.int("externalCalendarClaimCap").pipe(
		Config.withDefault(DEFAULT_EXTERNAL_CLAIM_CAP),
	),
});

// ---------------------------------------------------------------------------
// MailConfig — outbound SMTP credentials.
//
// Three layers, evaluated in priority order by EmailCredentialService:
//   1. Per-user credentials in the DB (encrypted at rest with EMAIL_CREDS_KEY)
//   2. Server-wide regex-scoped profiles (e.g. one SMTP relay for
//      `^.*@example\.com$`) — admins host email for their users and want
//      mail to be sent AS the user with no per-user setup.
//   3. Default fallback — single relay, mail goes out as `defaultFromAddress`
//      with `Reply-To: <user.email>` so replies still reach them.
//
// Profiles are configured via a JSON env var (`SMTP_PROFILES_JSON`) that
// decodes to an array of `MailProfile`. JSON keeps the schema flexible and
// avoids invented numbered-env-var conventions. Empty array = no profiles.
// ---------------------------------------------------------------------------

const SMTP_DEFAULT_PORT = 587;
const LMTP_DEFAULT_PORT = 2400;

interface RawMailProfileShape {
	readonly pattern: string;
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly password: string;
	readonly security?: "none" | "starttls" | "tls";
}

const decodeMailProfiles = (
	raw: string,
): ReadonlyArray<RawMailProfileShape> => {
	if (raw.trim() === "") {
		return [];
	}
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		// Best-effort shape filter; ConfigValidationError is preferable but
		// SMTP_PROFILES_JSON is admin-controlled, so we just drop malformed
		// entries rather than failing boot.
		return parsed.filter(
			(p): p is RawMailProfileShape =>
				typeof p === "object" &&
				p !== null &&
				typeof (p as { pattern?: unknown }).pattern === "string" &&
				typeof (p as { host?: unknown }).host === "string",
		);
	} catch {
		return [];
	}
};

export const MailConfig = Config.all({
	/**
	 * Enables outbound mail. When false (the default), every send is a no-op;
	 * EmailCredentialService still resolves so callers can preview but the
	 * mailer transport will short-circuit. Useful for personal / single-user
	 * deployments that don't need scheduling invitations.
	 */
	enabled: Config.boolean("mailEnabled").pipe(Config.withDefault(false)),
	/**
	 * Default sender address used when no per-user creds and no matching
	 * profile exist. Required when `mailEnabled` is true.
	 */
	defaultFromAddress: Config.string("smtpFromAddress").pipe(
		Config.withDefault(""),
	),
	defaultFromName: Config.string("smtpFromName").pipe(Config.withDefault("")),
	defaultHost: Config.string("smtpHost").pipe(Config.withDefault("")),
	defaultPort: Config.int("smtpPort").pipe(
		Config.withDefault(SMTP_DEFAULT_PORT),
	),
	defaultUsername: Config.string("smtpUsername").pipe(Config.withDefault("")),
	defaultPassword: Config.string("smtpPassword").pipe(Config.withDefault("")),
	defaultSecurity: Config.literals(
		["none", "starttls", "tls"],
		"smtpSecurity",
	).pipe(Config.withDefault("starttls")),
	/**
	 * Symmetric key used to encrypt per-user SMTP passwords stored in the DB.
	 * Required to write or read user-level creds; if unset, that source is
	 * disabled and the resolver falls through to profiles + default.
	 */
	credsKey: Config.string("emailCredsKey").pipe(Config.withDefault("")),
	/**
	 * iMIP LMTP listener. When `lmtpEnabled` is true a Deno TCP listener is
	 * spawned on `lmtpPort` (default 2400) accepting LMTP delivery from a
	 * front-end MTA (postfix `lmtp:` transport, dovecot, etc). Disabled by
	 * default — incoming iMIP isn't useful without a configured upstream.
	 */
	lmtpEnabled: Config.boolean("lmtpEnabled").pipe(Config.withDefault(false)),
	lmtpPort: Config.int("lmtpPort").pipe(Config.withDefault(LMTP_DEFAULT_PORT)),
	lmtpHost: Config.string("lmtpHost").pipe(Config.withDefault("127.0.0.1")),
	/**
	 * Server-wide regex-scoped SMTP profiles. JSON-encoded array; each entry:
	 *   {
	 *     "pattern": "^.*@example\\.com$",
	 *     "host": "smtp.example.com",
	 *     "port": 587,
	 *     "username": "relay@example.com",
	 *     "password": "…",
	 *     "security": "starttls"   // optional, defaults to starttls
	 *   }
	 * The first profile whose `pattern` matches the user's email is used; the
	 * resolver still sets From: to the user's address (the relay is expected
	 * to permit it).
	 */
	profiles: Config.string("smtpProfilesJson").pipe(
		Config.withDefault(""),
		Config.map(decodeMailProfiles),
	),
	/**
	 * Per-request SMTP creds passed by a trusted reverse proxy.
	 *
	 * When `proxyUsernameHeader` AND `proxyPasswordHeader` are both set, and
	 * the request comes from a trusted proxy IP (see `auth.trustedProxies`),
	 * the values from these headers override stored / profile / default SMTP
	 * creds for the duration of the request. Useful for SSO portals that
	 * already hold the user's mail credentials.
	 *
	 * Host/port/security headers are optional — fall back to the default
	 * profile values when absent. All headers must be configured in pairs
	 * with the proxy (no per-deploy split between username here and password
	 * there).
	 */
	proxyUsernameHeader: Config.string("smtpProxyUsernameHeader").pipe(
		Config.option,
	),
	proxyPasswordHeader: Config.string("smtpProxyPasswordHeader").pipe(
		Config.option,
	),
	proxyHostHeader: Config.string("smtpProxyHostHeader").pipe(Config.option),
	proxyPortHeader: Config.string("smtpProxyPortHeader").pipe(Config.option),
	proxySecurityHeader: Config.string("smtpProxySecurityHeader").pipe(
		Config.option,
	),
});

const BirthdayConfig = Config.all({
	/**
	 * Periodic-sweep cadence for BirthdayService. Idempotent + cheap (one
	 * addressbook scan + diff per principal); default 10 min catches edits
	 * even if write-side hooks miss them, without putting noticeable load on
	 * the DB.
	 */
	schedulerTickS: Config.int("birthdaySchedulerTickS").pipe(
		Config.withDefault(DEFAULT_BIRTHDAY_TICK_S),
	),
	/** Max principals reconciled in parallel per tick. */
	concurrency: Config.int("birthdayConcurrency").pipe(
		Config.withDefault(DEFAULT_BIRTHDAY_CONCURRENCY),
	),
});

export const AppConfig = Config.all({
	server: ServerConfig,
	metrics: MetricsConfig,
	database: DatabaseConfig,
	auth: AuthConfig,
	log: LogConfig,
	externalCalendar: ExternalCalendarConfig,
	birthday: BirthdayConfig,
	mail: MailConfig,
	nodeEnv: Config.string("nodeEnv").pipe(Config.withDefault("production")),
});

export type AppConfigType = Config.Success<typeof AppConfig>;

// ---------------------------------------------------------------------------
// AppConfigService — Effect service wrapping the full application config.
//
// All services that need configuration must depend on this service rather
// than reading env vars directly. This ensures a single, validated read
// of all config at layer-build time.
//
// The constantCase provider is applied here so it is active in every context
// (production, integration tests, etc.) without each call site having to
// remember to set it up.
// ---------------------------------------------------------------------------

export class AppConfigService extends Context.Service<AppConfigService>()(
	"AppConfigService",
	{
		make: AppConfig.pipe(
			// Apply constantCase to the ambient (env-backed) ConfigProvider so
			// camelCase keys here map to SCREAMING_SNAKE_CASE env vars.
			Effect.updateService(
				ConfigProvider.ConfigProvider,
				ConfigProvider.constantCase,
			),
		),
	},
) {}

export const AppConfigLive = Layer.effect(
	AppConfigService,
	AppConfigService.make,
);
