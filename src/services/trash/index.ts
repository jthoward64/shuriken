import { TrashServiceLive } from "./service.live.ts";

export { TrashNotFound, TrashNotOwner } from "./error.ts";
export { TrashServiceLive } from "./service.live.ts";
export type { TrashListing } from "./service.ts";
export { TrashService } from "./service.ts";

// ---------------------------------------------------------------------------
// TrashDomainLayer — pre-composed service
// Requires: CollectionRepository, InstanceRepository (provided by
// CollectionDomainLayer / InstanceDomainLayer in layers.ts)
// ---------------------------------------------------------------------------

export const TrashDomainLayer = TrashServiceLive;
