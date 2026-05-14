import { Layer } from "effect";
import { AclRepositoryLive } from "./repository.live.ts";
import { AclServiceLive } from "./service.live.ts";

export { AclRepositoryLive } from "./repository.live.ts";
export type { AceRow, AclResourceType, NewAce } from "./repository.ts";
export { AclRepository } from "./repository.ts";
export { AclServiceAllowAll } from "./service.allow-all.ts";
export { AclServiceLive } from "./service.live.ts";
export { AclService } from "./service.ts";

// ---------------------------------------------------------------------------
// AclDomainLayer — pre-composed service + repository
// Requires: DatabaseClient (provided by InfraLayer in layers.ts)
// ---------------------------------------------------------------------------

// Merging the repo lets handlers (e.g. the "shared with me" page) reach
// AclRepository directly for cheap lookups like getGroupPrincipalIds without
// going through the service tag.
export const AclDomainLayer = Layer.mergeAll(
	AclServiceLive.pipe(Layer.provide(AclRepositoryLive)),
	AclRepositoryLive,
);
