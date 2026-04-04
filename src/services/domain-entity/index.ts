import { Layer } from "effect";
import { ComponentRepositoryLive } from "#src/services/component/repository.live.ts";
import { EntityRepositoryLive } from "#src/services/entity/repository.live.ts";
import { DomainEntityServiceLive } from "./service.live.ts";

export { DomainEntityService } from "./service.ts";
export { DomainEntityServiceLive } from "./service.live.ts";

// ---------------------------------------------------------------------------
// DomainEntityDomainLayer — pre-composed service + both repositories
// Requires: DatabaseClient (provided by InfraLayer in layers.ts)
// ---------------------------------------------------------------------------

export const DomainEntityDomainLayer = DomainEntityServiceLive.pipe(
	Layer.provideMerge(ComponentRepositoryLive),
	Layer.provideMerge(EntityRepositoryLive),
);
