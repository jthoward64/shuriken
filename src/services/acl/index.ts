import { Layer } from "effect";
import { AclRepositoryLive } from "./repository.live.ts";
import { AclServiceLive } from "./service.live.ts";

export { AclRepository } from "./repository.ts";
export type { CasbinRuleRow, PolicyRule, RoleRule } from "./repository.ts";
export { AclService } from "./service.ts";
export { AclRepositoryLive } from "./repository.live.ts";
export { AclServiceLive } from "./service.live.ts";

// ---------------------------------------------------------------------------
// AclDomainLayer — pre-composed service + repository
// Requires: DatabaseClient (provided by InfraLayer in layers.ts)
// ---------------------------------------------------------------------------

export const AclDomainLayer = Layer.mergeAll(AclServiceLive, AclRepositoryLive);
