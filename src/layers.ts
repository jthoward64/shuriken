import { DevTools } from "@effect/experimental";
import { Effect, Layer, Logger } from "effect";
import { selectAuthLayer } from "#src/auth/index.ts";
import { AppConfigLive, AppConfigService } from "#src/config.ts";
import { type DatabaseClient, DatabaseClientLive } from "#src/db/client.ts";
import { TemplateServiceLive } from "#src/http/ui/template/index.ts";
import { type CryptoService, CryptoServiceLive } from "#src/platform/crypto.ts";
import { BunFileServiceLive } from "#src/platform/file.ts";
import { AclDomainLayer } from "#src/services/acl/index.ts";
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

// ---------------------------------------------------------------------------
// Infrastructure layer — foundational services shared by all domain layers
//
// AppConfigLive reads all env vars once. DatabaseClientLive depends on it for
// DATABASE_URL; we satisfy that dependency here so InfraLayer is self-contained.
// ---------------------------------------------------------------------------

export const InfraLayer = Layer.mergeAll(
	AppConfigLive,
	DatabaseClientLive.pipe(Layer.provide(AppConfigLive)),
	CryptoServiceLive,
);

// ---------------------------------------------------------------------------
// DevTools layer — only active when NODE_ENV=development
// ---------------------------------------------------------------------------

const DevToolsLayer = Layer.unwrapEffect(
	Effect.gen(function* () {
		const { nodeEnv } = yield* AppConfigService;
		return nodeEnv === "development" ? DevTools.layer() : Layer.empty;
	}),
).pipe(Layer.provide(InfraLayer));

// ---------------------------------------------------------------------------
// Auth layer — concrete implementation selected at startup from AUTH_MODE
// ---------------------------------------------------------------------------

export const AuthLayer = Layer.unwrapEffect(selectAuthLayer).pipe(
	Layer.provide(InfraLayer),
);

// ---------------------------------------------------------------------------
// Domain layer helper — each domain layer needs DatabaseClient from InfraLayer
// ---------------------------------------------------------------------------

const withInfra = <A, E>(
	layer: Layer.Layer<A, E, DatabaseClient | CryptoService>,
) => layer.pipe(Layer.provide(InfraLayer));

// ---------------------------------------------------------------------------
// AppLayer — full production layer composition
//
// To add a future service (CalendarService, SchedulingService, SyncService):
//   1. Create src/services/<name>/ with the 5-file pattern
//   2. Add `withInfra(<Name>DomainLayer)` here
// ---------------------------------------------------------------------------

// BaseAppLayer — all services except those with cross-domain dependencies.
const BaseAppLayer = Layer.mergeAll(
	Logger.pretty,
	InfraLayer,
	AuthLayer,
	DevToolsLayer,
	withInfra(PrincipalDomainLayer),
	withInfra(CollectionDomainLayer),
	withInfra(InstanceDomainLayer),
	withInfra(AclDomainLayer),
	withInfra(UserDomainLayer),
	withInfra(GroupDomainLayer),
	withInfra(DomainEntityDomainLayer),
	withInfra(TimezoneDomainLayer),
	IanaTimezoneService.Default,
	ProvisioningDomainLayer.pipe(Layer.provide(InfraLayer)),
	TombstoneRepositoryLive.pipe(Layer.provide(InfraLayer)),
	CalIndexRepositoryLive.pipe(Layer.provide(InfraLayer)),
	CardIndexRepositoryLive.pipe(Layer.provide(InfraLayer)),
	BunFileServiceLive,
	TemplateServiceLive.pipe(Layer.provide(BunFileServiceLive)),
);

// AppLayer — adds SchedulingDomainLayer, which depends on cross-domain services
// already provided by BaseAppLayer (DatabaseClient, AclService, ComponentRepository,
// EntityRepository, InstanceService, PrincipalRepository, CryptoService).
// Merge both: BaseAppLayer is used to satisfy SchedulingDomainLayer's requirements
// and Effect's Layer sharing ensures services are only initialized once.
export const AppLayer = Layer.merge(
	BaseAppLayer,
	SchedulingDomainLayer.pipe(Layer.provide(BaseAppLayer)),
);

// ---------------------------------------------------------------------------
// Re-export all service tags for use in handler R-type annotations
// ---------------------------------------------------------------------------

export { AuthService } from "#src/auth/service.ts";
export { DatabaseClient } from "#src/db/client.ts";
export { TemplateService } from "#src/http/ui/template/index.ts";
export { CryptoService } from "#src/platform/crypto.ts";
export { BunFileService } from "#src/platform/file.ts";
export { AclService } from "#src/services/acl/index.ts";
export {
	type CalComponentType,
	CalIndexRepository,
} from "#src/services/cal-index/index.ts";
export {
	type CardCollation,
	type CardIndexField,
	CardIndexRepository,
	type CardMatchType,
} from "#src/services/card-index/index.ts";
export {
	CollectionRepository,
	CollectionService,
} from "#src/services/collection/index.ts";
export { DomainEntityService } from "#src/services/domain-entity/index.ts";
export {
	GroupRepository,
	GroupService,
} from "#src/services/group/index.ts";
export {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
export {
	PrincipalRepository,
	PrincipalService,
} from "#src/services/principal/index.ts";
export { SchedulingService } from "#src/services/scheduling/index.ts";
export {
	CalTimezoneRepository,
	IanaTimezoneService,
} from "#src/services/timezone/index.ts";
export {
	TombstoneRepository,
	type TombstoneRow,
} from "#src/services/tombstone/index.ts";
export {
	UserRepository,
	UserService,
} from "#src/services/user/index.ts";
