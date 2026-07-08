import { Layer } from "effect";
import { SchedulingRepositoryLive } from "./repository.live.ts";
import { SchedulingServiceLive } from "./service.live.ts";

export { SchedulingRepositoryLive } from "./repository.live.ts";
export { SchedulingRepository } from "./repository.ts";
export { SchedulingServiceLive } from "./service.live.ts";
export { SchedulingService } from "./service.ts";
export type * from "./types.ts";

// ---------------------------------------------------------------------------
// SchedulingDomainLayer — pre-composed service + repository
// Requires: DatabaseClient, PrincipalRepository, ComponentRepository,
//           EntityRepository, InstanceService, AclService
// ---------------------------------------------------------------------------

export const SchedulingDomainLayer = SchedulingServiceLive.pipe(
	Layer.provide(SchedulingRepositoryLive),
);
