import { Layer } from "effect";
import { GroupRepositoryLive } from "./repository.live.ts";
import { GroupServiceLive } from "./service.live.ts";

export { GroupRepositoryLive } from "./repository.live.ts";
export type {
	GroupRow,
	GroupWithPrincipal,
	MembershipRow,
} from "./repository.ts";
export { GroupRepository } from "./repository.ts";
export { GroupServiceLive } from "./service.live.ts";
export type { NewGroup, UpdateGroup } from "./service.ts";
export { GroupService } from "./service.ts";

// ---------------------------------------------------------------------------
// GroupDomainLayer — pre-composed service + repository
// Requires: DatabaseClient (provided by InfraLayer)
// ---------------------------------------------------------------------------

export const GroupDomainLayer = GroupServiceLive.pipe(
	Layer.provideMerge(GroupRepositoryLive),
);
