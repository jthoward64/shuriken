import { Layer } from "effect";
import { InstanceRepositoryLive } from "./repository.live.ts";
import { InstanceServiceLive } from "./service.live.ts";

export { InstanceRepositoryLive } from "./repository.live.ts";
export type { InstanceRow, NewInstance } from "./repository.ts";
export { InstanceRepository } from "./repository.ts";
export { InstanceServiceLive } from "./service.live.ts";
export { InstanceService } from "./service.ts";

// ---------------------------------------------------------------------------
// InstanceDomainLayer — pre-composed service + repository
// Requires: DatabaseClient (provided by InfraLayer in layers.ts)
// ---------------------------------------------------------------------------

export const InstanceDomainLayer = InstanceServiceLive.pipe(
	Layer.provideMerge(InstanceRepositoryLive),
);
