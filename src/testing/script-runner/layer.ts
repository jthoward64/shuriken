import { Effect, Layer, Option, Redacted, References } from "effect";
import { BasicAuthLayer } from "#src/auth/layers/basic.ts";
import { AppConfigService, type AppConfigType } from "#src/config.ts";
import type { DatabaseClient } from "#src/db/client.ts";
import { ClientJsService } from "#src/http/ui/client/index.ts";
import { CssService } from "#src/http/ui/css/index.ts";
import { PageCacheServiceLive } from "#src/http/ui/page-cache/index.ts";
import type { CryptoService } from "#src/platform/crypto.ts";
import { FileService } from "#src/platform/file.ts";
import { AclDomainLayer, AclRepositoryLive } from "#src/services/acl/index.ts";
import { AppPasswordRepositoryLive } from "#src/services/app-password/repository.live.ts";
import { AppPasswordServiceLive } from "#src/services/app-password/service.live.ts";
import { BirthdayServiceLive } from "#src/services/birthday/service.live.ts";
import { BulkJobRepositoryLive } from "#src/services/bulk-job/index.ts";
import { CalEditServiceLive } from "#src/services/cal-edit/service.live.ts";
import { CalIndexRepositoryLive } from "#src/services/cal-index/index.ts";
import { CardEditServiceLive } from "#src/services/card-edit/service.live.ts";
import { CardIndexRepositoryLive } from "#src/services/card-index/index.ts";
import { CollectionDomainLayer } from "#src/services/collection/index.ts";
import { ContactCleanupServiceLive } from "#src/services/contact-cleanup/service.live.ts";
import { ContactMergeServiceLive } from "#src/services/contact-merge/service.live.ts";
import { DomainEntityDomainLayer } from "#src/services/domain-entity/index.ts";
import { UserEmailCredentialRepositoryLive } from "#src/services/email-credential/repository.live.ts";
import { EmailCredentialServiceLive } from "#src/services/email-credential/service.live.ts";
import { ExternalCalendarRepositoryLive } from "#src/services/external-calendar/repository.live.ts";
import { SubscriptionServiceLive } from "#src/services/external-calendar/subscription.live.ts";
import { GroupDomainLayer } from "#src/services/group/index.ts";
import { ImipDispatchServiceLive } from "#src/services/imip/dispatch.live.ts";
import { ImipInboundServiceLive } from "#src/services/imip/inbound.live.ts";
import { InstanceDomainLayer } from "#src/services/instance/index.ts";
import { MailerServiceLive } from "#src/services/mailer/service.live.ts";
import { OidcServiceLive } from "#src/services/oidc/service.live.ts";
import { PrincipalDomainLayer } from "#src/services/principal/index.ts";
import { ProvisioningDomainLayer } from "#src/services/provisioning/index.ts";
import { SchedulingDomainLayer } from "#src/services/scheduling/index.ts";
import { OidcLoginRepositoryLive } from "#src/services/session/oidc-login-repository.live.ts";
import { SessionRepositoryLive } from "#src/services/session/repository.live.ts";
import { SessionServiceLive } from "#src/services/session/service.live.ts";
import { ShareLinkRepositoryLive } from "#src/services/share-link/repository.live.ts";
import { ShareLinkServiceLive } from "#src/services/share-link/service.live.ts";
import { TaskEditServiceLive } from "#src/services/task-edit/service.live.ts";
import {
	IanaTimezoneServiceLive,
	TimezoneDomainLayer,
} from "#src/services/timezone/index.ts";
import { TombstoneRepositoryLive } from "#src/services/tombstone/index.ts";
import { TrashServiceLive } from "#src/services/trash/service.live.ts";
import { UserDomainLayer } from "#src/services/user/index.ts";
import { TestCryptoLayer } from "#src/testing/env.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";

// ---------------------------------------------------------------------------
// Test config layer
//
// Provides AppConfigService with basic auth mode and a dummy database URL
// (bypassed by the PGlite layer). Does not read any environment variables.
// ---------------------------------------------------------------------------

const testConfig: AppConfigType = {
	server: { port: 3000, host: "localhost" },
	metrics: { enabled: false, port: 9464 },
	database: { url: Redacted.make("postgres://unused") },
	auth: {
		autoLogin: Option.none<string>(),
		trustedProxies: "*",
		basicAuthEnabled: true,
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
		sessionTtlDays: 7,
		oidcGroupsClaim: Option.none<string>(),
		oidcRoleMap: new Map<string, string>(),
	},
	log: { level: undefined },
	externalCalendar: {
		schedulerTickS: 60,
		fetchConcurrency: 4,
		claimCap: 100,
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
		defaultPassword: "",
		defaultSecurity: "starttls" as const,
		credsKey: "",
		lmtpEnabled: false,
		lmtpPort: 2400,
		lmtpHost: "127.0.0.1",
		profiles: [] as ReadonlyArray<{
			pattern: string;
			host: string;
			port: number;
			username: string;
			password: string;
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

const AppConfigTestLayer = Layer.succeed(AppConfigService, testConfig);

// ---------------------------------------------------------------------------
// makeScriptRunnerLayer
//
// Returns a fresh layer for one runScript call. Each call clones a fresh
// PGlite database so scripts are fully isolated from each other.
//
// The layer mirrors AppLayer from src/layers.ts but substitutes:
//   - AppConfigTestLayer     instead of AppConfigLive   (no env-var reads)
//   - makePgliteDatabaseLayer() instead of DatabaseClientLive (in-memory DB)
//   - TestCryptoLayer        instead of CryptoServiceLive (no real hashing)
//   - BasicAuthLayer         always (multi-user support via Basic auth)
// ---------------------------------------------------------------------------

export const makeScriptRunnerLayer = (overrides?: Partial<AppConfigType>) => {
	const merged: AppConfigType = overrides
		? { ...testConfig, ...overrides }
		: testConfig;
	const configLayer =
		overrides === undefined
			? AppConfigTestLayer
			: Layer.succeed(AppConfigService, merged);
	const testInfraLayer = Layer.mergeAll(
		configLayer,
		makePgliteDatabaseLayer(),
		TestCryptoLayer,
	);

	const withTestInfra = <A, E>(
		layer: Layer.Layer<A, E, DatabaseClient | CryptoService>,
	) => layer.pipe(Layer.provide(testInfraLayer));

	const testBaseLayer = Layer.mergeAll(
		testInfraLayer,
		Layer.succeed(References.MinimumLogLevel, "None"),
		BasicAuthLayer.pipe(Layer.provide(testInfraLayer)),
		withTestInfra(PrincipalDomainLayer),
		withTestInfra(CollectionDomainLayer),
		withTestInfra(InstanceDomainLayer),
		withTestInfra(AclDomainLayer),
		withTestInfra(AclRepositoryLive),
		withTestInfra(UserDomainLayer),
		withTestInfra(GroupDomainLayer),
		withTestInfra(DomainEntityDomainLayer),
		withTestInfra(TimezoneDomainLayer),
		IanaTimezoneServiceLive,
		withTestInfra(ProvisioningDomainLayer),
		withTestInfra(TombstoneRepositoryLive),
		withTestInfra(BulkJobRepositoryLive),
		withTestInfra(CalIndexRepositoryLive),
		withTestInfra(CardIndexRepositoryLive),
		withTestInfra(UserEmailCredentialRepositoryLive),
		withTestInfra(ExternalCalendarRepositoryLive),
		withTestInfra(ShareLinkRepositoryLive),
		withTestInfra(SessionRepositoryLive),
		SessionServiceLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					testInfraLayer,
					SessionRepositoryLive.pipe(Layer.provide(testInfraLayer)),
				),
			),
		),
		withTestInfra(OidcLoginRepositoryLive),
		OidcServiceLive.pipe(Layer.provide(testInfraLayer)),
		withTestInfra(AppPasswordRepositoryLive),
		AppPasswordServiceLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					testInfraLayer,
					AppPasswordRepositoryLive.pipe(Layer.provide(testInfraLayer)),
				),
			),
		),
	);

	const testStubsLayer = Layer.mergeAll(
		Layer.succeed(FileService, {
			readText: () => Effect.die("stub"),
			readBytes: () => Effect.die("stub"),
			exists: () => Effect.succeed(false),
			mimeType: () => undefined,
			glob: () => Effect.succeed([]),
		}),
		Layer.succeed(CssService, { css: "", etag: '"test"' }),
		Layer.succeed(ClientJsService, { assets: new Map() }),
		PageCacheServiceLive,
	);

	return Layer.mergeAll(
		testBaseLayer,
		SchedulingDomainLayer.pipe(Layer.provide(testBaseLayer)),
		SubscriptionServiceLive.pipe(Layer.provide(testBaseLayer)),
		BirthdayServiceLive.pipe(Layer.provide(testBaseLayer)),
		CardEditServiceLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					testBaseLayer,
					BirthdayServiceLive.pipe(Layer.provide(testBaseLayer)),
				),
			),
		),
		ContactCleanupServiceLive.pipe(Layer.provide(testBaseLayer)),
		ContactMergeServiceLive.pipe(Layer.provide(testBaseLayer)),
		CalEditServiceLive.pipe(Layer.provide(testBaseLayer)),
		TaskEditServiceLive.pipe(Layer.provide(testBaseLayer)),
		ShareLinkServiceLive.pipe(Layer.provide(testBaseLayer)),
		TrashServiceLive.pipe(Layer.provide(testBaseLayer)),
		EmailCredentialServiceLive.pipe(Layer.provide(testBaseLayer)),
		MailerServiceLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					testBaseLayer,
					EmailCredentialServiceLive.pipe(Layer.provide(testBaseLayer)),
				),
			),
		),
		ImipInboundServiceLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					testBaseLayer,
					CalEditServiceLive.pipe(Layer.provide(testBaseLayer)),
				),
			),
		),
		ImipDispatchServiceLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					testBaseLayer,
					EmailCredentialServiceLive.pipe(Layer.provide(testBaseLayer)),
					MailerServiceLive.pipe(
						Layer.provide(
							Layer.mergeAll(
								testBaseLayer,
								EmailCredentialServiceLive.pipe(Layer.provide(testBaseLayer)),
							),
						),
					),
				),
			),
		),
		testStubsLayer,
	);
};
