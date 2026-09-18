import type { Redacted } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import type {
	CollectionType,
	ContentType,
	GrantDeny,
	PrincipalType,
	ResourceType,
} from "#src/db/drizzle/schema/index.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { AceRow } from "#src/services/acl/repository.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import type { EntityRow } from "#src/services/entity/repository.ts";
import type {
	AutoAssignedBySource,
	GroupRow,
} from "#src/services/group/repository.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import type {
	PrincipalRow,
	UserRow,
} from "#src/services/principal/repository.ts";
import type { Role } from "#src/services/role/policy.ts";
import type { CalTimezoneRow } from "#src/services/timezone/index.ts";
import type { AuthUserRow } from "#src/services/user/repository.ts";

// ---------------------------------------------------------------------------
// TestStores — shared in-memory state across all in-memory repositories
//
// Repositories that operate on the same logical tables share the same Maps
// (e.g. UserRepository and PrincipalRepository both use `principals` and
// `users`), ensuring cross-service consistency without a real database.
// ---------------------------------------------------------------------------

export interface TestStores {
	readonly principals: Map<string, PrincipalRow>; // principal.id → PrincipalRow (users only)
	readonly users: Map<string, UserRow>; // user.id → UserRow
	readonly credentials: Map<string, AuthUserRow>; // `${authSource}:${authId}` → AuthUserRow
	readonly collections: Map<string, CollectionRow>; // collection.id → CollectionRow
	readonly instances: Map<string, InstanceRow>; // instance.id → InstanceRow
	readonly groupPrincipals: Map<string, PrincipalRow>; // principal.id → PrincipalRow (groups only)
	readonly groups: Map<string, GroupRow>; // group.id → GroupRow
	readonly memberships: Map<string, Set<string>>; // groupId → Set<userId>
	readonly membershipAutoAssignedBy: Map<string, AutoAssignedBySource | null>; // `${groupId}:${userId}` → source
	readonly acl: Map<string, Array<AceRow>>; // resourceId → all ACEs for that resource
	readonly entities: Map<string, EntityRow>; // entityId → EntityRow
	readonly components: Map<string, IrComponent>; // entityId → root IrComponent
	readonly calTimezones: Map<string, CalTimezoneRow>; // tzid → CalTimezoneRow
}

/** A fresh, empty set of in-memory tables */
export const makeStores = (): TestStores => ({
	principals: new Map(),
	users: new Map(),
	credentials: new Map(),
	collections: new Map(),
	instances: new Map(),
	groupPrincipals: new Map(),
	groups: new Map(),
	memberships: new Map(),
	membershipAutoAssignedBy: new Map(),
	acl: new Map(),
	entities: new Map(),
	components: new Map(),
	calTimezones: new Map(),
});

// ---------------------------------------------------------------------------
// Seed data types
// ---------------------------------------------------------------------------

export interface UserSeedData {
	readonly id?: UuidString;
	readonly principalId?: UuidString;
	readonly slug?: string;
	readonly email?: string;
	readonly displayName?: string;
	readonly role?: Role;
}

export interface CollectionSeedData {
	readonly id?: UuidString;
	readonly ownerPrincipalId: UuidString;
	readonly collectionType?: CollectionType;
	readonly slug?: string;
	readonly displayName?: string;
}

export interface GroupSeedData {
	readonly id?: UuidString;
	readonly principalId?: UuidString;
	readonly slug?: string;
	readonly displayName?: string;
	readonly oidcGroups?: ReadonlyArray<string>;
}

export interface InstanceSeedData {
	readonly id?: UuidString;
	readonly collectionId: UuidString;
	readonly entityId?: UuidString;
	readonly contentType?: ContentType;
	readonly etag?: string;
	readonly slug?: string;
}

export interface CredentialSeedData {
	readonly userId: UuidString;
	readonly authSource: string;
	readonly authId: string;
	readonly authCredential?: Redacted.Redacted<string>;
}

export interface AceSeedData {
	readonly resourceType: ResourceType;
	readonly resourceId: UuidString;
	readonly principalType: PrincipalType;
	readonly principalId?: UuidString;
	readonly privilege: DavPrivilege;
	readonly grantDeny?: GrantDeny;
	readonly protected?: boolean;
	readonly ordinal?: number;
}

// ---------------------------------------------------------------------------
// Table accessors — each table as an array in insertion order, so repository
// queries read as a filter over rows rather than a spread of a Map iterator.
// ---------------------------------------------------------------------------

/** Every user principal row */
export const allPrincipals = (
	stores: TestStores,
): ReadonlyArray<PrincipalRow> => [...stores.principals.values()];

/** Every user row */
export const allUsers = (stores: TestStores): ReadonlyArray<UserRow> => [
	...stores.users.values(),
];

/** Every credential row */
export const allCredentials = (
	stores: TestStores,
): ReadonlyArray<AuthUserRow> => [...stores.credentials.values()];

/** Every collection row */
export const allCollections = (
	stores: TestStores,
): ReadonlyArray<CollectionRow> => [...stores.collections.values()];

/** Every instance row */
export const allInstances = (
	stores: TestStores,
): ReadonlyArray<InstanceRow> => [...stores.instances.values()];

/** Every group principal row */
export const allGroupPrincipals = (
	stores: TestStores,
): ReadonlyArray<PrincipalRow> => [...stores.groupPrincipals.values()];

/** Every group row */
export const allGroups = (stores: TestStores): ReadonlyArray<GroupRow> => [
	...stores.groups.values(),
];
