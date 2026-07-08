export { ComponentRepositoryLive } from "./repository.live.ts";
export { ComponentRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// ComponentDomainLayer — repository only (no service layer for component)
// Requires: DatabaseClient (provided by InfraLayer in layers.ts)
// ---------------------------------------------------------------------------

export { ComponentRepositoryLive as ComponentDomainLayer } from "./repository.live.ts";
