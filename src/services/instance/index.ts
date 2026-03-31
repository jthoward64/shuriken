import { Layer } from "effect";
import { InstanceRepositoryLive } from "./repository.live.ts";
import { InstanceServiceLive } from "./service.live.ts";

export { InstanceRepository } from "./repository.ts";
export type { InstanceRow, NewInstance } from "./repository.ts";
export { InstanceService } from "./service.ts";
export { InstanceRepositoryLive } from "./repository.live.ts";
export { InstanceServiceLive } from "./service.live.ts";

// ---------------------------------------------------------------------------
// InstanceDomainLayer — pre-composed service + repository
// Requires: DatabaseClient (provided by InfraLayer in layers.ts)
// ---------------------------------------------------------------------------

export const InstanceDomainLayer = InstanceServiceLive.pipe(
  Layer.provideMerge(InstanceRepositoryLive),
);
