import { Config, ConfigProvider, Effect } from "effect";

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
	port: Config.integer("port").pipe(Config.withDefault(DEFAULT_PORT)),
	host: Config.string("host").pipe(Config.withDefault("::")),
});

export const DatabaseConfig = Config.all({
	url: Config.redacted("databaseUrl"),
});

export const AuthConfig = Config.all({
	/**
	 * Auto-login email. When set, all requests are authenticated as this user
	 * without credential checks. Use for development or single-user self-hosted
	 * setups. Takes precedence over both proxy and basic auth.
	 */
	autoLogin: Config.string("autoLogin").pipe(Config.option),

	/**
	 * Header the reverse proxy injects with the authenticated username.
	 * When set, proxy auth is enabled and requests from trusted IPs (see
	 * TRUSTED_PROXIES) are authenticated via this header. Leave unset to
	 * disable proxy auth.
	 */
	proxyHeader: Config.string("proxyHeader").pipe(Config.option),
	/**
	 * Optional header carrying the new user's role tag when proxy auth
	 * auto-creates them. Header value should match a role from
	 * `services/role/policy.ts` (e.g. "admin", "super_admin"); unknown
	 * values fall back to "normal".
	 */
	proxyRoleHeader: Config.string("proxyRoleHeader").pipe(Config.option),

	/**
	 * Comma-separated list of trusted proxy IPs, or "*" to trust all.
	 * Only meaningful when PROXY_HEADER is set; requests from untrusted IPs
	 * have the proxy header ignored.
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
	 * When true and proxy auth identifies an unknown email, the user is
	 * auto-provisioned with the role from `proxyRoleHeader` (default
	 * "normal"). Off by default — opt in only when the proxy is the
	 * authoritative source of truth for user identity.
	 */
	proxyAutoProvision: Config.boolean("proxyAutoProvision").pipe(
		Config.withDefault(false),
	),
});

export const LogConfig = Config.all({
	level: Config.logLevel("logLevel").pipe(Config.withDefault(undefined)),
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
	schedulerTickS: Config.integer("externalCalendarSchedulerTickS").pipe(
		Config.withDefault(DEFAULT_EXTERNAL_TICK_S),
	),
	/**
	 * Maximum number of URLs the scheduler will fetch in parallel per tick.
	 * Each one is an outbound HTTP call + DB transaction per claim, so 4
	 * gives reasonable throughput without overloading slow upstreams.
	 */
	fetchConcurrency: Config.integer("externalCalendarFetchConcurrency").pipe(
		Config.withDefault(DEFAULT_EXTERNAL_CONCURRENCY),
	),
	/**
	 * Soft DoS guard on claims-per-URL. New claim requests beyond this cap
	 * are rejected by the create endpoint. Per-tenant deployments can leave
	 * this generous; public-facing multi-tenant deployments may want it
	 * lower.
	 */
	claimCap: Config.integer("externalCalendarClaimCap").pipe(
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
	defaultPort: Config.integer("smtpPort").pipe(
		Config.withDefault(SMTP_DEFAULT_PORT),
	),
	defaultUsername: Config.string("smtpUsername").pipe(Config.withDefault("")),
	defaultPassword: Config.string("smtpPassword").pipe(Config.withDefault("")),
	defaultSecurity: Config.literal(
		"none",
		"starttls",
		"tls",
	)("smtpSecurity").pipe(Config.withDefault("starttls")),
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
	lmtpPort: Config.integer("lmtpPort").pipe(
		Config.withDefault(LMTP_DEFAULT_PORT),
	),
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
	schedulerTickS: Config.integer("birthdaySchedulerTickS").pipe(
		Config.withDefault(DEFAULT_BIRTHDAY_TICK_S),
	),
	/** Max principals reconciled in parallel per tick. */
	concurrency: Config.integer("birthdayConcurrency").pipe(
		Config.withDefault(DEFAULT_BIRTHDAY_CONCURRENCY),
	),
});

export const AppConfig = Config.all({
	server: ServerConfig,
	database: DatabaseConfig,
	auth: AuthConfig,
	log: LogConfig,
	externalCalendar: ExternalCalendarConfig,
	birthday: BirthdayConfig,
	mail: MailConfig,
	nodeEnv: Config.string("nodeEnv").pipe(Config.withDefault("production")),
});

export type AppConfigType = Config.Config.Success<typeof AppConfig>;

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

export class AppConfigService extends Effect.Service<AppConfigService>()(
	"AppConfigService",
	{
		effect: AppConfig.pipe(
			Effect.withConfigProvider(
				ConfigProvider.fromEnv().pipe(ConfigProvider.constantCase),
			),
		),
	},
) {}

export const AppConfigLive = AppConfigService.Default;
