import { Effect, Layer, Logger, LogLevel, Option, Redacted } from "effect";
import { BasicAuthLayer } from "#src/auth/layers/basic.ts";
import { AppConfigService, type AppConfigType } from "#src/config.ts";
import type { DatabaseClient } from "#src/db/client.ts";
import { TemplateService } from "#src/http/ui/template/index.ts";
import type { CryptoService } from "#src/platform/crypto.ts";
import { BunFileService } from "#src/platform/file.ts";
import { AclDomainLayer, AclRepositoryLive } from "#src/services/acl/index.ts";
import { BirthdayServiceLive } from "#src/services/birthday/service.live.ts";
import { CalEditServiceLive } from "#src/services/cal-edit/service.live.ts";
import { CalIndexRepositoryLive } from "#src/services/cal-index/index.ts";
import { CardEditServiceLive } from "#src/services/card-edit/service.live.ts";
import { CardIndexRepositoryLive } from "#src/services/card-index/index.ts";
import { CollectionDomainLayer } from "#src/services/collection/index.ts";
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
import { PrincipalDomainLayer } from "#src/services/principal/index.ts";
import { ProvisioningDomainLayer } from "#src/services/provisioning/index.ts";
import { SchedulingDomainLayer } from "#src/services/scheduling/index.ts";
import {
	IanaTimezoneService,
	TimezoneDomainLayer,
} from "#src/services/timezone/index.ts";
import { TombstoneRepositoryLive } from "#src/services/tombstone/index.ts";
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
	database: { url: Redacted.make("postgres://unused") },
	auth: {
		autoLogin: Option.none<string>(),
		proxyHeader: Option.none<string>(),
		proxyRoleHeader: Option.none<string>(),
		trustedProxies: "*",
		basicAuthEnabled: true,
		adminEmail: Option.none<string>(),
		adminPassword: Option.none<Redacted.Redacted<string>>(),
		adminSlug: Option.none<string>(),
		authSettingsUrl: Option.none<string>(),
		authSettingsLabel: Option.none<string>(),
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
	nodeEnv: "test",
};

const AppConfigTestLayer = Layer.succeed(
	AppConfigService,
	testConfig as unknown as AppConfigService,
);

// ---------------------------------------------------------------------------
// makeScriptRunnerLayer
//
// Returns a fresh layer for one runScript call. Each call clones a fresh
// PGlite database so scripts are fully isolated from each other.
//
// The layer mirrors AppLayer from src/layers.ts but substitutes:
//   - AppConfigTestLayer     instead of AppConfigLive   (no env-var reads)
//   - makePgliteDatabaseLayer() instead of DatabaseClientLive (in-memory DB)
//   - TestCryptoLayer        instead of CryptoServiceLive (no Bun.password)
//   - BasicAuthLayer         always (multi-user support via Basic auth)
// ---------------------------------------------------------------------------

export const makeScriptRunnerLayer = (overrides?: Partial<AppConfigType>) => {
	const merged: AppConfigType = overrides
		? { ...testConfig, ...overrides }
		: testConfig;
	const configLayer =
		overrides === undefined
			? AppConfigTestLayer
			: Layer.succeed(AppConfigService, merged as unknown as AppConfigService);
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
		Logger.minimumLogLevel(LogLevel.None),
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
		IanaTimezoneService.Default,
		withTestInfra(ProvisioningDomainLayer),
		withTestInfra(TombstoneRepositoryLive),
		withTestInfra(CalIndexRepositoryLive),
		withTestInfra(CardIndexRepositoryLive),
		withTestInfra(UserEmailCredentialRepositoryLive),
		withTestInfra(ExternalCalendarRepositoryLive),
	);

	const testStubsLayer = Layer.mergeAll(
		Layer.succeed(BunFileService, {
			readText: () => Effect.die("stub"),
			readBytes: () => Effect.die("stub"),
			exists: () => Effect.succeed(false),
			mimeType: () => undefined,
			glob: () => Effect.succeed([]),
		}),
		Layer.succeed(TemplateService, {
			render: (
				_name: string,
				_ctx: Record<string, unknown>,
				_isHtmx: boolean,
			) => Effect.succeed("<!DOCTYPE html><body>test</body>"),
			renderFragment: (_name: string, _ctx: Record<string, unknown>) =>
				Effect.succeed("<div>test</div>"),
		}),
	);

	return Layer.mergeAll(
		testBaseLayer,
		SchedulingDomainLayer.pipe(Layer.provide(testBaseLayer)),
		SubscriptionServiceLive.pipe(Layer.provide(testBaseLayer)),
		BirthdayServiceLive.pipe(Layer.provide(testBaseLayer)),
		CardEditServiceLive.pipe(Layer.provide(testBaseLayer)),
		CalEditServiceLive.pipe(Layer.provide(testBaseLayer)),
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
