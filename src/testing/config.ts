import { Option, Redacted } from "effect";
import type { AppConfigType } from "#src/config.ts";

// ---------------------------------------------------------------------------
// Test app config
//
// A complete AppConfigType in basic-auth mode with a dummy database URL
// (bypassed by the PGlite layer). Reads no environment variables. Shared by any
// test that needs to construct a layer depending on AppConfigService.
// ---------------------------------------------------------------------------

export const testAppConfig: AppConfigType = {
	server: { port: 3000, host: "localhost" },
	metrics: { enabled: false, port: 9464 },
	database: { url: Redacted.make("postgres://unused") },
	auth: {
		autoLogin: Option.none<string>(),
		trustedProxies: "*",
		basicAuthEnabled: true,
		authRateLimitMaxAttempts: 10,
		authRateLimitWindowS: 60,
		adminEmail: Option.none<string>(),
		adminPassword: Option.none<Redacted.Redacted<string>>(),
		adminSlug: Option.none<string>(),
		authSettingsUrl: Option.none<string>(),
		authSettingsLabel: Option.none<string>(),
		oidcEnabled: false,
		oidcIssuer: Option.none<string>(),
		oidcClientId: Option.none<string>(),
		oidcClientSecret: Option.none<Redacted.Redacted<string>>(),
		oidcRedirectUri: Option.none<string>(),
		oidcScopes: "openid profile email",
		oidcAutoProvision: true,
		oidcRequireEmailVerified: true,
		sessionTtlDays: 7,
		oidcGroupsClaim: Option.none<string>(),
		oidcRoleMap: new Map<string, string>(),
	},
	sharing: { userSearchMode: "admin_only" },
	log: { level: undefined },
	recurrence: { rruleMaxOccurrences: 200_000, rruleTimeBudgetMs: 250 },
	externalCalendar: {
		schedulerTickS: 60,
		fetchConcurrency: 4,
		claimCap: 100,
		maxResponseBytes: 26_214_400,
		maxRedirects: 5,
	},
	birthday: {
		schedulerTickS: 600,
		concurrency: 4,
		startupJitterMaxS: 0,
		sweepSpreadS: 0,
	},
	trash: {
		retentionDays: 30,
	},
	mail: {
		enabled: false,
		defaultFromAddress: "",
		defaultFromName: "",
		defaultHost: "",
		defaultPort: 587,
		defaultUsername: "",
		defaultPassword: Redacted.make(""),
		defaultSecurity: "starttls" as const,
		credsKey: Redacted.make(""),
		lmtpEnabled: false,
		lmtpPort: 2400,
		lmtpHost: "127.0.0.1",
		lmtpMaxDataBytes: 26_214_400,
		lmtpMaxRecipients: 100,
		profiles: [] as ReadonlyArray<{
			pattern: string;
			host: string;
			port: number;
			username: string;
			password: Redacted.Redacted<string>;
			security?: "none" | "starttls" | "tls";
		}>,
	},
	embed: {
		panesEnabled: false,
		calendarWidgetEnabled: false,
	},
	securityHeaders: {
		enabled: true,
		cspEnabled: true,
		frameAncestors: [] as ReadonlyArray<string>,
		xContentTypeOptionsEnabled: true,
		referrerPolicyEnabled: true,
		hstsEnabled: true,
		permissionsPolicyEnabled: true,
	},
	nodeEnv: "test",
};

/** Returns `testAppConfig` with the given fields overridden. */
export const makeTestConfig = (
	overrides?: Partial<AppConfigType>,
): AppConfigType =>
	overrides ? { ...testAppConfig, ...overrides } : testAppConfig;
