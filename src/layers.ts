import { Layer } from "effect";
import { selectAuthLayer } from "#src/auth/index.ts";
import { type DatabaseClient, DatabaseClientLive } from "#src/db/client.ts";
import { CryptoServiceLive } from "#src/platform/crypto.ts";
import { AclDomainLayer } from "#src/services/acl/index.ts";
import { CollectionDomainLayer } from "#src/services/collection/index.ts";
import { InstanceDomainLayer } from "#src/services/instance/index.ts";
import { PrincipalDomainLayer } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// Infrastructure layer — foundational services shared by all domain layers
// ---------------------------------------------------------------------------

export const InfraLayer = Layer.merge(DatabaseClientLive, CryptoServiceLive);

// ---------------------------------------------------------------------------
// Auth layer — concrete implementation selected at startup from AUTH_MODE
// ---------------------------------------------------------------------------

export const AuthLayer = Layer.unwrapEffect(selectAuthLayer).pipe(
	Layer.provide(InfraLayer),
);

// ---------------------------------------------------------------------------
// Domain layer helper — each domain layer needs DatabaseClient from InfraLayer
// ---------------------------------------------------------------------------

const withInfra = <A, E>(layer: Layer.Layer<A, E, DatabaseClient>) =>
	layer.pipe(Layer.provide(InfraLayer));

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
	withInfra(AclDomainLayer),
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
export {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
export {
	PrincipalRepository,
	PrincipalService,
} from "#src/services/principal/index.ts";
