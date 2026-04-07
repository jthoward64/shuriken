import { Layer } from "effect";
import { selectAuthLayer } from "#src/auth/index.ts";
import { AppConfigLive } from "#src/config.ts";
import { type DatabaseClient, DatabaseClientLive } from "#src/db/client.ts";
import { type CryptoService, CryptoServiceLive } from "#src/platform/crypto.ts";
import { AclServiceAllowAll } from "#src/services/acl/index.ts";
import { CollectionDomainLayer } from "#src/services/collection/index.ts";
import { DomainEntityDomainLayer } from "#src/services/domain-entity/index.ts";
import { GroupDomainLayer } from "#src/services/group/index.ts";
import { InstanceDomainLayer } from "#src/services/instance/index.ts";
import { PrincipalDomainLayer } from "#src/services/principal/index.ts";
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

export const AppLayer = Layer.mergeAll(
	InfraLayer,
	AuthLayer,
	withInfra(PrincipalDomainLayer),
	withInfra(CollectionDomainLayer),
	withInfra(InstanceDomainLayer),
	// TODO: swap AclServiceAllowAll for withInfra(AclDomainLayer) once ACL is wired into handlers
	AclServiceAllowAll,
	withInfra(UserDomainLayer),
	withInfra(GroupDomainLayer),
	withInfra(DomainEntityDomainLayer),
);

// ---------------------------------------------------------------------------
// Re-export all service tags for use in handler R-type annotations
// ---------------------------------------------------------------------------

export { AuthService } from "#src/auth/service.ts";
export { DatabaseClient } from "#src/db/client.ts";
export { CryptoService } from "#src/platform/crypto.ts";
export { AclService } from "#src/services/acl/index.ts";
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
export {
	UserRepository,
	UserService,
} from "#src/services/user/index.ts";
