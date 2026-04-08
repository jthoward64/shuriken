import { Layer } from "effect";
import { AclRepositoryLive } from "#src/services/acl/index.ts";
import { UserRepositoryLive } from "./repository.live.ts";
import { UserServiceLive } from "./service.live.ts";

export { UserRepositoryLive } from "./repository.live.ts";
export type {
	AuthUserRow,
	HashedCredential,
	UserWithPrincipal,
} from "./repository.ts";
export { UserRepository } from "./repository.ts";
export { UserServiceLive } from "./service.live.ts";
export type { NewCredential, NewUser, UpdateUser } from "./service.ts";
export { UserService } from "./service.ts";

// ---------------------------------------------------------------------------
// UserDomainLayer — pre-composed service + repository
// Requires: DatabaseClient + CryptoService (both provided by InfraLayer)
// ---------------------------------------------------------------------------

export const UserDomainLayer = UserServiceLive.pipe(
	Layer.provideMerge(UserRepositoryLive),
).pipe(Layer.provide(AclRepositoryLive));
