import type { Effect } from "effect";
import { Context } from "effect";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import type { UserWithPrincipal } from "#src/services/user/repository.ts";
import type { NewCredential } from "#src/services/user/service.ts";

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface ProvisionUserInput {
	readonly email: Email;
	readonly name: string;
	readonly slug: Slug;
	readonly credentials?: ReadonlyArray<NewCredential>;
}

export interface ProvisionedUser {
	readonly user: UserWithPrincipal;
	readonly calendar: CollectionRow;
	readonly addressBook: CollectionRow;
	readonly inbox: CollectionRow;
	readonly outbox: CollectionRow;
}

// ---------------------------------------------------------------------------
// ProvisioningService — orchestrates user creation with default collections
// ---------------------------------------------------------------------------

export interface ProvisioningServiceShape {
	/**
	 * Create a user and provision their primary calendar and address book.
	 * Fails with ConflictError if the user (by email or slug) already exists.
	 */
	readonly provisionUser: (
		input: ProvisionUserInput,
	) => Effect.Effect<
		ProvisionedUser,
		ConflictError | DatabaseError | DavError | InternalError
	>;

	/**
	 * Idempotently ensure the given principal has DAV:all on the users and groups
	 * virtual resources. Called at startup for the admin user in every auth mode
	 * so that existing setups gain the ACEs without a DB migration.
	 */
	readonly ensureAdminAces: (
		principalId: PrincipalId,
	) => Effect.Effect<void, DatabaseError>;
}

export class ProvisioningService extends Context.Tag("ProvisioningService")<
	ProvisioningService,
	ProvisioningServiceShape
>() {}
