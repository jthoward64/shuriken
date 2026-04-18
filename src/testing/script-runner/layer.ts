import { Layer, Logger, LogLevel, Option, Redacted } from "effect";
import { BasicAuthLayer } from "#src/auth/layers/basic.ts";
import { AppConfigService, type AppConfigType } from "#src/config.ts";
import type { DatabaseClient } from "#src/db/client.ts";
import type { CryptoService } from "#src/platform/crypto.ts";
import { AclDomainLayer, AclRepositoryLive } from "#src/services/acl/index.ts";
import { CalIndexRepositoryLive } from "#src/services/cal-index/index.ts";
import { CardIndexRepositoryLive } from "#src/services/card-index/index.ts";
import { CollectionDomainLayer } from "#src/services/collection/index.ts";
import { DomainEntityDomainLayer } from "#src/services/domain-entity/index.ts";
import { GroupDomainLayer } from "#src/services/group/index.ts";
import { InstanceDomainLayer } from "#src/services/instance/index.ts";
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
		mode: "basic",
		proxyHeader: "X-Remote-User",
		trustedProxies: "*",
		singleUserEmail: Option.none<string>(),
	},
	log: { level: undefined },
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

export const makeScriptRunnerLayer = () => {
	const testInfraLayer = Layer.mergeAll(
		AppConfigTestLayer,
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
	);

	return Layer.merge(
		testBaseLayer,
		SchedulingDomainLayer.pipe(Layer.provide(testBaseLayer)),
	);
};
