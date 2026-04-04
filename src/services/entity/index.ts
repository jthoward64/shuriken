export { EntityRepositoryLive } from "./repository.live.ts";
export { EntityRepository, type EntityRow } from "./repository.ts";

// ---------------------------------------------------------------------------
// EntityDomainLayer — repository only (no service layer for entity)
// Requires: DatabaseClient (provided by InfraLayer in layers.ts)
// ---------------------------------------------------------------------------

export { EntityRepositoryLive as EntityDomainLayer } from "./repository.live.ts";
