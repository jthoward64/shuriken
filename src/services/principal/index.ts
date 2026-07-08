import { Layer } from "effect";
import { PrincipalRepositoryLive } from "./repository.live.ts";
import { PrincipalServiceLive } from "./service.live.ts";

export { PrincipalRepositoryLive } from "./repository.live.ts";
export type { PrincipalRow, PrincipalWithUser, UserRow } from "./repository.ts";
export { PrincipalRepository } from "./repository.ts";
export { PrincipalServiceLive } from "./service.live.ts";
export { PrincipalService } from "./service.ts";

// ---------------------------------------------------------------------------
// PrincipalDomainLayer — pre-composed service + repository
// Requires: DatabaseClient (provided by InfraLayer in layers.ts)
// ---------------------------------------------------------------------------

export const PrincipalDomainLayer = PrincipalServiceLive.pipe(
	Layer.provideMerge(PrincipalRepositoryLive),
);
