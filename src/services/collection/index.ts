import { Layer } from "effect";
import { CollectionRepositoryLive } from "./repository.live.ts";
import { CollectionServiceLive } from "./service.live.ts";

export { CollectionRepositoryLive } from "./repository.live.ts";
export type { CollectionRow, NewCollection } from "./repository.ts";
export { CollectionRepository } from "./repository.ts";
export { CollectionServiceLive } from "./service.live.ts";
export { CollectionService } from "./service.ts";

// ---------------------------------------------------------------------------
// CollectionDomainLayer — pre-composed service + repository
// Requires: DatabaseClient (provided by InfraLayer in layers.ts)
// ---------------------------------------------------------------------------

export const CollectionDomainLayer = CollectionServiceLive.pipe(
	Layer.provideMerge(CollectionRepositoryLive),
);
