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

export type AuthMode = "single-user" | "basic" | "proxy";

export const AuthConfig = Config.all({
	/**
	 * Auth mode selection.
	 * - single-user: no credentials checked; all requests are one configured user
	 * - basic:       HTTP Basic Authentication against auth_user table
	 * - proxy:       trust a reverse-proxy header (e.g. X-Remote-User)
	 */
	mode: Config.string("authMode").pipe(
		Config.withDefault("single-user"),
		Config.map((s): AuthMode => {
			if (s === "single-user" || s === "basic" || s === "proxy") {
				return s;
			} else {
				throw new Error(
					`Invalid AUTH_MODE "${s}". Must be single-user, basic, or proxy.`,
				);
			}
		}),
	),

	/** Header the reverse proxy injects with the authenticated username. */
	proxyHeader: Config.string("proxyHeader").pipe(
		Config.withDefault("X-Remote-User"),
	),

	/**
	 * Comma-separated list of trusted proxy IPs, or "*" to trust all.
	 * When AUTH_MODE=proxy, requests from untrusted IPs have the proxy header ignored.
	 */
	trustedProxies: Config.string("trustedProxies").pipe(
		Config.withDefault("*"),
	),

	/** Email of the single user in single-user mode. Optional; uses first user if absent. */
	singleUserEmail: Config.string("singleUserEmail").pipe(Config.option),
});

export const LogConfig = Config.all({
	level: Config.logLevel("logLevel").pipe(Config.withDefault(undefined)),
});

export const AppConfig = Config.all({
	server: ServerConfig,
	database: DatabaseConfig,
	auth: AuthConfig,
	log: LogConfig,
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
