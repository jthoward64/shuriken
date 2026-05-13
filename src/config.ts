import { Config, ConfigProvider, Effect } from "effect";

// ---------------------------------------------------------------------------
// Application configuration — all env vars read through Effect's Config API.
// Bun takes care of loading .env files automatically
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
});

export const LogConfig = Config.all({
	level: Config.logLevel("logLevel").pipe(Config.withDefault(undefined)),
});

const DEFAULT_EXTERNAL_TICK_S = 60;
const DEFAULT_EXTERNAL_CONCURRENCY = 4;
const DEFAULT_EXTERNAL_CLAIM_CAP = 100;

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

export const AppConfig = Config.all({
	server: ServerConfig,
	database: DatabaseConfig,
	auth: AuthConfig,
	log: LogConfig,
	externalCalendar: ExternalCalendarConfig,
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
