// ---------------------------------------------------------------------------
// SchedulingDeps - the collaborators the scheduling operations run against
//
// Resolved once when SchedulingServiceLive is built and threaded explicitly
// into the operation modules, so each one stays a top-level function.
// ---------------------------------------------------------------------------

import type { DbClient } from "#src/db/client.ts";
import type { AclServiceShape } from "#src/services/acl/service.ts";
import type { ComponentRepositoryShape } from "#src/services/component/repository.ts";
import type { EntityRepositoryShape } from "#src/services/entity/repository.ts";
import type { InstanceServiceShape } from "#src/services/instance/service.ts";
import type { PrincipalRepositoryShape } from "#src/services/principal/repository.ts";
import type { SchedulingRepositoryShape } from "./repository.ts";

export interface SchedulingDeps {
	readonly repo: SchedulingRepositoryShape;
	readonly principalRepo: PrincipalRepositoryShape;
	readonly componentRepo: ComponentRepositoryShape;
	readonly entityRepo: EntityRepositoryShape;
	readonly instanceSvc: InstanceServiceShape;
	readonly aclSvc: AclServiceShape;
	readonly db: DbClient;
}
