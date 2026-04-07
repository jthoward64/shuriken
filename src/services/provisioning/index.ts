import { Layer } from "effect";
import { CollectionServiceLive } from "#src/services/collection/service.live.ts";
import { CollectionRepositoryLive } from "#src/services/collection/index.ts";
import { UserServiceLive } from "#src/services/user/service.live.ts";
import { UserRepositoryLive } from "#src/services/user/index.ts";
import { ProvisioningServiceLive } from "./service.live.ts";

export { ProvisioningServiceLive } from "./service.live.ts";
export type {
	ProvisionUserInput,
	ProvisionedUser,
} from "./service.ts";
export { ProvisioningService } from "./service.ts";

// ---------------------------------------------------------------------------
// ProvisioningDomainLayer — pre-composed with all required dependencies
// Requires: DatabaseClient + CryptoService (both provided by InfraLayer)
// ---------------------------------------------------------------------------

const CollectionDep = CollectionServiceLive.pipe(
	Layer.provideMerge(CollectionRepositoryLive),
);

const UserDep = UserServiceLive.pipe(Layer.provideMerge(UserRepositoryLive));

export const ProvisioningDomainLayer = ProvisioningServiceLive.pipe(
	Layer.provide(Layer.mergeAll(CollectionDep, UserDep)),
);
