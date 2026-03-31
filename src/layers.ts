import { Layer } from "effect";
import { selectAuthLayer } from "#/auth/index.ts";
import { DatabaseClientLive, type DatabaseClient } from "#/db/client.ts";
import { CryptoServiceLive } from "#/platform/crypto.ts";
import { AclDomainLayer } from "#/services/acl/index.ts";
import { CollectionDomainLayer } from "#/services/collection/index.ts";
import { InstanceDomainLayer } from "#/services/instance/index.ts";
import { PrincipalDomainLayer } from "#/services/principal/index.ts";

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

export { AuthService } from "#/auth/service.ts";
export { DatabaseClient } from "#/db/client.ts";
export { CryptoService } from "#/platform/crypto.ts";
export { AclService } from "#/services/acl/index.ts";
export { CollectionService } from "#/services/collection/index.ts";
export { CollectionRepository } from "#/services/collection/index.ts";
export { InstanceService } from "#/services/instance/index.ts";
export { InstanceRepository } from "#/services/instance/index.ts";
export { PrincipalService } from "#/services/principal/index.ts";
export { PrincipalRepository } from "#/services/principal/index.ts";
