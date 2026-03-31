import { Config } from "effect";

// ---------------------------------------------------------------------------
// Application configuration — all env vars read through Effect's Config API.
// `dotenv/config` is imported in src/index.ts before this is evaluated,
// so process.env is already populated with .env values when these run.
// No code outside this file (and index.ts) should access process.env directly.
// ---------------------------------------------------------------------------

export const ServerConfig = Config.all({
  port: Config.integer("PORT").pipe(Config.withDefault(3000)),
  host: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
});

export const DatabaseConfig = Config.all({
  url: Config.string("DATABASE_URL"),
});

export type AuthMode = "single-user" | "basic" | "proxy";

export const AuthConfig = Config.all({
  /**
   * Auth mode selection.
   * - single-user: no credentials checked; all requests are one configured user
   * - basic:       HTTP Basic Authentication against auth_user table
   * - proxy:       trust a reverse-proxy header (e.g. X-Remote-User)
   */
  mode: Config.string("AUTH_MODE").pipe(
    Config.withDefault("single-user"),
    Config.map((s): AuthMode => {
      if (s === "single-user" || s === "basic" || s === "proxy") return s;
      throw new Error(
        `Invalid AUTH_MODE "${s}". Must be single-user, basic, or proxy.`,
      );
    }),
  ),

  /** Header the reverse proxy injects with the authenticated username. */
  proxyHeader: Config.string("PROXY_HEADER").pipe(
    Config.withDefault("X-Remote-User"),
  ),

  /**
   * Comma-separated list of trusted proxy IPs, or "*" to trust all.
   * When AUTH_MODE=proxy, requests from untrusted IPs have the proxy header ignored.
   */
  trustedProxies: Config.string("TRUSTED_PROXIES").pipe(
    Config.withDefault("*"),
  ),

  /** Email of the single user in single-user mode. Optional; uses first user if absent. */
  singleUserEmail: Config.string("SINGLE_USER_EMAIL").pipe(Config.option),
});

export const LogConfig = Config.all({
  level: Config.logLevel("LOG_LEVEL").pipe(Config.withDefault(undefined)),
});

export const AppConfig = Config.all({
  server: ServerConfig,
  database: DatabaseConfig,
  auth: AuthConfig,
  log: LogConfig,
});

export type AppConfigType = Config.Config.Success<typeof AppConfig>;
