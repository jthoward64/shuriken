import { Effect, Layer, Option, Redacted } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrComponent } from "#src/data/ir.ts";
import { ComponentId, type UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import { CryptoService } from "#src/platform/crypto.ts";
import {
	type AceRow,
	AclRepository,
	type AclRepositoryShape,
	type AclResourceType,
	type NewAce,
} from "#src/services/acl/repository.ts";
import { AclServiceLive } from "#src/services/acl/service.live.ts";
import type { AclService } from "#src/services/acl/service.ts";
import {
	CollectionRepository,
	type CollectionPropertyChanges,
	type CollectionRepositoryShape,
	type CollectionRow,
	type NewCollection,
} from "#src/services/collection/repository.ts";
import { CollectionServiceLive } from "#src/services/collection/service.live.ts";
import type { CollectionService } from "#src/services/collection/service.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import type { ComponentRepositoryShape } from "#src/services/component/repository.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import type {
	EntityRepositoryShape,
	EntityRow,
} from "#src/services/entity/repository.ts";
import {
	GroupRepository,
	type GroupRepositoryShape,
	type GroupRow,
} from "#src/services/group/repository.ts";
import { GroupServiceLive } from "#src/services/group/service.live.ts";
import type { GroupService } from "#src/services/group/service.ts";
import {
	InstanceRepository,
	type InstanceRepositoryShape,
	type InstanceRow,
	type NewInstance,
} from "#src/services/instance/repository.ts";
import { InstanceServiceLive } from "#src/services/instance/service.live.ts";
import type { InstanceService } from "#src/services/instance/service.ts";
import {
	PrincipalRepository,
	type PrincipalPropertyChanges,
	type PrincipalRepositoryShape,
	type PrincipalRow,
	type UserRow,
} from "#src/services/principal/repository.ts";
import { PrincipalServiceLive } from "#src/services/principal/service.live.ts";
import type { PrincipalService } from "#src/services/principal/service.ts";
import {
	CalTimezoneRepository,
	type CalTimezoneRow,
} from "#src/services/timezone/index.ts";
import type { CalTimezoneRepositoryShape } from "#src/services/timezone/repository.ts";
import {
	type AuthUserRow,
	UserRepository,
	type UserRepositoryShape,
} from "#src/services/user/repository.ts";
import { UserServiceLive } from "#src/services/user/service.live.ts";
import type { UserService } from "#src/services/user/service.ts";

// ---------------------------------------------------------------------------
// TestCryptoLayer
//
// Identity-based crypto — no Bun.password dependency.
// hashPassword prepends "test:" so verifyPassword can validate without bcrypt.
// ---------------------------------------------------------------------------

const TEST_HASH_PREFIX = "test:";

export const TestCryptoLayer = Layer.succeed(CryptoService, {
	hashPassword: (plain) =>
		Effect.succeed(
			Redacted.make(`${TEST_HASH_PREFIX}${Redacted.value(plain)}`),
		),
	verifyPassword: (plain, hash) =>
		Effect.succeed(
			Redacted.value(hash) === `${TEST_HASH_PREFIX}${Redacted.value(plain)}`,
		),
});

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
	readonly acl: Map<string, Array<AceRow>>; // resourceId → all ACEs for that resource
	readonly entities: Map<string, EntityRow>; // entityId → EntityRow
	readonly components: Map<string, IrComponent>; // entityId → root IrComponent
	readonly calTimezones: Map<string, CalTimezoneRow>; // tzid → CalTimezoneRow
}

const makeStores = (): TestStores => ({
	principals: new Map(),
	users: new Map(),
	credentials: new Map(),
	collections: new Map(),
	instances: new Map(),
	groupPrincipals: new Map(),
	groups: new Map(),
	memberships: new Map(),
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
	readonly name?: string;
	readonly email?: string;
	readonly displayName?: string;
}

export interface CollectionSeedData {
	readonly id?: UuidString;
	readonly ownerPrincipalId: UuidString;
	readonly collectionType?: string;
	readonly slug?: string;
	readonly displayName?: string;
}

export interface GroupSeedData {
	readonly id?: UuidString;
	readonly principalId?: UuidString;
	readonly slug?: string;
	readonly displayName?: string;
}

export interface InstanceSeedData {
	readonly id?: UuidString;
	readonly collectionId: UuidString;
	readonly entityId?: UuidString;
	readonly contentType?: string;
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
	readonly resourceType: AclResourceType;
	readonly resourceId: UuidString;
	readonly principalType:
		| "principal"
		| "all"
		| "authenticated"
		| "unauthenticated"
		| "self";
	readonly principalId?: UuidString;
	readonly privilege: DavPrivilege;
	readonly grantDeny?: "grant" | "deny";
	readonly protected?: boolean;
	readonly ordinal?: number;
}

// ---------------------------------------------------------------------------
// In-memory repository implementations
// ---------------------------------------------------------------------------

const makeUserRepo = (stores: TestStores): UserRepositoryShape => ({
	findById: (id) =>
		Effect.succeed(
			Option.fromNullable(
				(() => {
					const userRow = stores.users.get(id);
					if (!userRow) {
						return null;
					}
					const principalRow = stores.principals.get(userRow.principalId);
					if (!principalRow) {
						return null;
					}
					return { user: userRow, principal: principalRow };
				})(),
			),
		),

	findByEmail: (email) =>
		Effect.succeed(
			Option.fromNullable(
				(() => {
					const userRow = [...stores.users.values()].find(
						(u) => u.email === email,
					);
					if (!userRow) {
						return null;
					}
					const principalRow = stores.principals.get(userRow.principalId);
					if (!principalRow) {
						return null;
					}
					return { user: userRow, principal: principalRow };
				})(),
			),
		),

	create: (input) =>
		Effect.sync(() => {
			const principalId = crypto.randomUUID();
			const userId = crypto.randomUUID();
			const now = Temporal.Now.instant();

			const principalRow: PrincipalRow = {
				id: principalId,
				principalType: "user",
				displayName: input.displayName ?? null,
				updatedAt: now,
				deletedAt: null,
				slug: input.slug,
			};
			const userRow: UserRow = {
				id: userId,
				name: input.name,
				email: input.email,
				updatedAt: now,
				principalId,
			};

			stores.principals.set(principalId, principalRow);
			stores.users.set(userId, userRow);

			for (const cred of input.credentials) {
				const credRow: AuthUserRow = {
					id: crypto.randomUUID(),
					userId,
					authSource: cred.authSource,
					authId: cred.authId,
					updatedAt: now,
					authCredential: Option.getOrNull(cred.authCredential),
				};
				stores.credentials.set(`${cred.authSource}:${cred.authId}`, credRow);
			}

			return { user: userRow, principal: principalRow };
		}),

	update: (id, input) =>
		Effect.sync(() => {
			const existingUser = stores.users.get(id);
			if (!existingUser) {
				throw new Error(`[TestEnv] User not found: ${id}`);
			}
			const existingPrincipal = stores.principals.get(existingUser.principalId);
			if (!existingPrincipal) {
				throw new Error(
					`[TestEnv] Principal not found: ${existingUser.principalId}`,
				);
			}

			const now = Temporal.Now.instant();
			const updatedUser: UserRow = {
				...existingUser,
				name: input.name ?? existingUser.name,
				email: input.email ?? existingUser.email,
				updatedAt: now,
			};
			const updatedPrincipal: PrincipalRow = {
				...existingPrincipal,
				displayName:
					input.displayName !== undefined
						? input.displayName
						: existingPrincipal.displayName,
				updatedAt: now,
			};

			stores.users.set(id, updatedUser);
			stores.principals.set(existingUser.principalId, updatedPrincipal);

			return { user: updatedUser, principal: updatedPrincipal };
		}),

	findCredential: (authSource, authId) =>
		Effect.succeed(
			Option.fromNullable(
				stores.credentials.get(`${authSource}:${authId}`) ?? null,
			),
		),

	insertCredential: (input) =>
		Effect.sync(() => {
			const now = Temporal.Now.instant();
			const credRow: AuthUserRow = {
				id: crypto.randomUUID(),
				userId: input.userId,
				authSource: input.authSource,
				authId: input.authId,
				updatedAt: now,
				authCredential: Option.getOrNull(input.authCredential),
			};
			stores.credentials.set(`${input.authSource}:${input.authId}`, credRow);
			return credRow;
		}),

	deleteCredential: (_userId, authSource, authId) =>
		Effect.sync(() => {
			stores.credentials.delete(`${authSource}:${authId}`);
		}),
});

const makePrincipalRepo = (stores: TestStores): PrincipalRepositoryShape => ({
	findById: (id) =>
		Effect.succeed(
			Option.fromNullable(
				(() => {
					const principalRow = stores.principals.get(id);
					if (!principalRow) {
						return null;
					}
					const userRow = [...stores.users.values()].find(
						(u) => u.principalId === id,
					);
					if (!userRow) {
						return null;
					}
					return { principal: principalRow, user: userRow };
				})(),
			),
		),

	findBySlug: (slug) =>
		Effect.succeed(
			Option.fromNullable(
				(() => {
					const principalRow = [...stores.principals.values()].find(
						(p) => p.slug === slug && p.deletedAt === null,
					);
					if (!principalRow) {
						return null;
					}
					const userRow = [...stores.users.values()].find(
						(u) => u.principalId === principalRow.id,
					);
					if (!userRow) {
						return null;
					}
					return { principal: principalRow, user: userRow };
				})(),
			),
		),

	findByEmail: (email) =>
		Effect.succeed(
			Option.fromNullable(
				(() => {
					const userRow = [...stores.users.values()].find(
						(u) => u.email === email,
					);
					if (!userRow) {
						return null;
					}
					const principalRow = stores.principals.get(userRow.principalId);
					if (!principalRow) {
						return null;
					}
					return { principal: principalRow, user: userRow };
				})(),
			),
		),

	findUserByUserId: (id) =>
		Effect.succeed(Option.fromNullable(stores.users.get(id) ?? null)),

	updateProperties: (id, changes: PrincipalPropertyChanges) =>
		Effect.sync(() => {
			const row = stores.principals.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Principal not found for property update: ${id}`);
			}
			const updated: PrincipalRow = {
				...row,
				clientProperties: changes.clientProperties,
				...(changes.displayName !== undefined
					? { displayName: changes.displayName }
					: {}),
				updatedAt: Temporal.Now.instant(),
			};
			stores.principals.set(id, updated);
			return updated;
		}),
});

const makeCollectionRepo = (stores: TestStores): CollectionRepositoryShape => ({
	findById: (id) =>
		Effect.succeed(
			Option.fromNullable(
				(() => {
					const row = stores.collections.get(id);
					return row && row.deletedAt === null ? row : null;
				})(),
			),
		),

	findBySlug: (ownerPrincipalId, collectionType, slug) =>
		Effect.succeed(
			Option.fromNullable(
				[...stores.collections.values()].find(
					(c) =>
						c.ownerPrincipalId === ownerPrincipalId &&
						c.collectionType === collectionType &&
						c.slug === slug &&
						c.deletedAt === null,
				) ?? null,
			),
		),

	listByOwner: (ownerPrincipalId) =>
		Effect.succeed(
			[...stores.collections.values()].filter(
				(c) => c.ownerPrincipalId === ownerPrincipalId && c.deletedAt === null,
			),
		),

	insert: (input: NewCollection) =>
		Effect.sync(() => {
			const now = Temporal.Now.instant();
			const row: CollectionRow = {
				id: crypto.randomUUID(),
				ownerPrincipalId: input.ownerPrincipalId,
				collectionType: input.collectionType,
				displayName: input.displayName ?? null,
				description: input.description ?? null,
				timezoneTzid: input.timezoneTzid ?? null,
				synctoken: 0,
				updatedAt: now,
				deletedAt: null,
				supportedComponents: input.supportedComponents ?? null,
				slug: input.slug,
				parentCollectionId: input.parentCollectionId ?? null,
				clientProperties: {},
				maxResourceSize: null,
				minDateTime: null,
				maxDateTime: null,
				maxInstances: null,
				maxAttendeesPerInstance: null,
			};
			stores.collections.set(row.id, row);
			return row;
		}),

	softDelete: (id) =>
		Effect.sync(() => {
			const row = stores.collections.get(id);
			if (!row) {
				throw new Error(`Collection not found for deletion: ${id}`);
			}
			const deleted = { ...row, deletedAt: Temporal.Now.instant() };
			stores.collections.set(id, deleted);
			return deleted;
		}),

	relocate: (id, targetOwnerPrincipalId, targetSlug) =>
		Effect.sync(() => {
			const row = stores.collections.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Collection not found for relocation: ${id}`);
			}
			const updated = {
				...row,
				ownerPrincipalId: targetOwnerPrincipalId,
				slug: targetSlug,
				updatedAt: Temporal.Now.instant(),
			};
			stores.collections.set(id, updated);
			return updated;
		}),

	updateProperties: (id, changes: CollectionPropertyChanges) =>
		Effect.sync(() => {
			const row = stores.collections.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Collection not found for property update: ${id}`);
			}
			const updated: CollectionRow = {
				...row,
				clientProperties: changes.clientProperties,
				...(changes.displayName !== undefined
					? { displayName: changes.displayName }
					: {}),
				...(changes.description !== undefined
					? { description: changes.description }
					: {}),
				updatedAt: Temporal.Now.instant(),
			};
			stores.collections.set(id, updated);
			return updated;
		}),
});

const makeInstanceRepo = (stores: TestStores): InstanceRepositoryShape => ({
	findById: (id) =>
		Effect.succeed(
			Option.fromNullable(
				(() => {
					const row = stores.instances.get(id);
					return row && row.deletedAt === null ? row : null;
				})(),
			),
		),

	findBySlug: (collectionId, slug) =>
		Effect.succeed(
			Option.fromNullable(
				[...stores.instances.values()].find(
					(i) =>
						i.collectionId === collectionId &&
						i.slug === slug &&
						i.deletedAt === null,
				) ?? null,
			),
		),

	listByCollection: (collectionId) =>
		Effect.succeed(
			[...stores.instances.values()].filter(
				(i) => i.collectionId === collectionId && i.deletedAt === null,
			),
		),

	findChangedSince: (collectionId, sinceSyncRevision) =>
		Effect.succeed(
			[...stores.instances.values()].filter(
				(i) =>
					i.collectionId === collectionId &&
					i.syncRevision > sinceSyncRevision &&
					i.deletedAt === null,
			),
		),

	findByIds: (ids) =>
		Effect.succeed(
			ids
				.map((id) => stores.instances.get(id))
				.filter(
					(i): i is InstanceRow => i !== undefined && i.deletedAt === null,
				),
		),

	insert: (input: NewInstance) =>
		Effect.sync(() => {
			const now = Temporal.Now.instant();
			// Simulate DB trigger: syncRevision = 1 on first insert
			const row: InstanceRow = {
				id: crypto.randomUUID(),
				collectionId: input.collectionId,
				entityId: input.entityId,
				contentType: input.contentType,
				etag: input.etag,
				syncRevision: 1,
				lastModified: now,
				updatedAt: now,
				deletedAt: null,
				scheduleTag: input.scheduleTag ?? null,
				slug: input.slug,
				clientProperties: {},
			};
			stores.instances.set(row.id, row);
			return row;
		}),

	updateEtag: (id, etag) =>
		Effect.sync(() => {
			const row = stores.instances.get(id);
			if (row) {
				// Simulate DB trigger: increment syncRevision on each update
				stores.instances.set(id, {
					...row,
					etag,
					syncRevision: row.syncRevision + 1,
					updatedAt: Temporal.Now.instant(),
				});
			}
		}),

	softDelete: (id) =>
		Effect.sync(() => {
			const row = stores.instances.get(id);
			if (row) {
				stores.instances.set(id, {
					...row,
					deletedAt: Temporal.Now.instant(),
				});
			}
		}),

	relocate: (id, targetCollectionId, targetSlug) =>
		Effect.sync(() => {
			const row = stores.instances.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Instance not found for relocation: ${id}`);
			}
			const updated = {
				...row,
				collectionId: targetCollectionId,
				slug: targetSlug,
				updatedAt: Temporal.Now.instant(),
			};
			stores.instances.set(id, updated);
			return updated;
		}),

	updateClientProperties: (id, clientProperties) =>
		Effect.sync(() => {
			const row = stores.instances.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Instance not found for property update: ${id}`);
			}
			const updated: InstanceRow = {
				...row,
				clientProperties,
				updatedAt: Temporal.Now.instant(),
			};
			stores.instances.set(id, updated);
			return updated;
		}),
});

// ---------------------------------------------------------------------------
// Principal-matching helper — mirrors the SQL logic in repository.live.ts
// ---------------------------------------------------------------------------

const matchesPrincipal = (
	ace: AceRow,
	principalIds: ReadonlyArray<string>,
	isAuthenticated: boolean,
): boolean => {
	if (ace.principalType === "all") {
		return true;
	}
	if (ace.principalType === "authenticated") {
		return isAuthenticated;
	}
	if (ace.principalType === "unauthenticated") {
		return !isAuthenticated;
	}
	if (ace.principalType === "principal" && ace.principalId !== null) {
		return principalIds.includes(ace.principalId);
	}
	return false;
};

const makeAclRepo = (stores: TestStores): AclRepositoryShape => ({
	getAces: (resourceId, resourceType) =>
		Effect.succeed(
			(stores.acl.get(resourceId) ?? [])
				.filter((a) => a.resourceType === resourceType)
				.sort((a, b) => a.ordinal - b.ordinal),
		),

	setAces: (resourceId, resourceType, aces) =>
		Effect.sync(() => {
			const existing = stores.acl.get(resourceId) ?? [];
			const kept = existing.filter(
				(a) => a.resourceType !== resourceType || a.protected,
			);
			const now = Temporal.Now.instant();
			const newRows: Array<AceRow> = aces.map((ace) => ({
				id: crypto.randomUUID(),
				resourceType: ace.resourceType,
				resourceId: ace.resourceId,
				principalType: ace.principalType,
				principalId: ace.principalId ?? null,
				privilege: ace.privilege,
				grantDeny: ace.grantDeny,
				protected: ace.protected,
				ordinal: ace.ordinal,
				updatedAt: now,
			}));
			stores.acl.set(resourceId, [...kept, ...newRows]);
		}),

	grantAce: (ace: NewAce) =>
		Effect.sync(() => {
			const existing = stores.acl.get(ace.resourceId) ?? [];
			stores.acl.set(ace.resourceId, [
				...existing,
				{
					id: crypto.randomUUID(),
					resourceType: ace.resourceType,
					resourceId: ace.resourceId,
					principalType: ace.principalType,
					principalId: ace.principalId ?? null,
					privilege: ace.privilege,
					grantDeny: ace.grantDeny,
					protected: ace.protected,
					ordinal: ace.ordinal,
					updatedAt: Temporal.Now.instant(),
				},
			]);
		}),

	hasPrivilege: (
		principalIds,
		resourceId,
		resourceType,
		privileges,
		isAuthenticated,
	) =>
		Effect.succeed(
			(stores.acl.get(resourceId) ?? []).some(
				(ace) =>
					ace.resourceType === resourceType &&
					ace.grantDeny === "grant" &&
					(privileges as ReadonlyArray<string>).includes(ace.privilege) &&
					matchesPrincipal(ace, principalIds, isAuthenticated),
			),
		),

	getGrantedPrivileges: (
		principalIds,
		resourceId,
		resourceType,
		isAuthenticated,
	) =>
		Effect.succeed([
			...new Set(
				(stores.acl.get(resourceId) ?? [])
					.filter(
						(ace) =>
							ace.resourceType === resourceType &&
							ace.grantDeny === "grant" &&
							matchesPrincipal(ace, principalIds, isAuthenticated),
					)
					.map((ace) => ace.privilege as DavPrivilege),
			),
		]),

	getGroupPrincipalIds: (userPrincipalId) =>
		Effect.sync(() => {
			const userRow = [...stores.users.values()].find(
				(u) => u.principalId === userPrincipalId,
			);
			if (!userRow) {
				return [];
			}
			return [...stores.memberships.entries()]
				.filter(([, members]) => members.has(userRow.id))
				.flatMap(([groupId]) => {
					const groupRow = stores.groups.get(groupId);
					if (!groupRow) {
						return [];
					}
					return [
						groupRow.principalId as import("#src/domain/ids.ts").PrincipalId,
					];
				});
		}),

	getResourceParent: (resourceId, resourceType) =>
		Effect.sync(() => {
			if (resourceType === "instance") {
				const inst = stores.instances.get(resourceId);
				if (!inst) {
					return Option.none<{
						readonly id: UuidString;
						readonly type: AclResourceType;
					}>();
				}
				return Option.some({
					id: inst.collectionId as UuidString,
					type: "collection" as const,
				});
			}
			if (resourceType === "collection") {
				const col = stores.collections.get(resourceId);
				if (!col) {
					return Option.none<{
						readonly id: UuidString;
						readonly type: AclResourceType;
					}>();
				}
				if (col.parentCollectionId) {
					return Option.some({
						id: col.parentCollectionId as UuidString,
						type: "collection" as const,
					});
				}
				return Option.some({
					id: col.ownerPrincipalId as UuidString,
					type: "principal" as const,
				});
			}
			// principal — top of the hierarchy
			return Option.none<{
				readonly id: UuidString;
				readonly type: AclResourceType;
			}>();
		}),
});

const makeEntityRepo = (stores: TestStores): EntityRepositoryShape => ({
	insert: ({ entityType, logicalUid }) =>
		Effect.sync(() => {
			const id = crypto.randomUUID();
			const row: EntityRow = {
				id,
				entityType,
				logicalUid: logicalUid ?? null,
				updatedAt: null as unknown as EntityRow["updatedAt"],
				deletedAt: null,
			};
			stores.entities.set(id, row);
			return row;
		}),

	findById: (id) =>
		Effect.succeed(Option.fromNullable(stores.entities.get(id) ?? null)),

	updateLogicalUid: (id, uid) =>
		Effect.sync(() => {
			const row = stores.entities.get(id);
			if (row) {
				stores.entities.set(id, { ...row, logicalUid: uid });
			}
		}),

	softDelete: (id) =>
		Effect.sync(() => {
			stores.entities.delete(id);
		}),
});

const makeComponentRepo = (stores: TestStores): ComponentRepositoryShape => ({
	insertTree: (entityId, root) =>
		Effect.sync(() => {
			stores.components.set(entityId, root);
			return ComponentId(crypto.randomUUID());
		}),

	loadTree: (entityId, _entityType) =>
		Effect.succeed(
			Option.fromNullable(stores.components.get(entityId) ?? null),
		),

	deleteByEntity: (entityId) =>
		Effect.sync(() => {
			stores.components.delete(entityId);
		}),
});

const makeCalTimezoneRepo = (
	stores: TestStores,
): CalTimezoneRepositoryShape => ({
	findByTzid: (tzid) =>
		Effect.succeed(Option.fromNullable(stores.calTimezones.get(tzid) ?? null)),

	upsert: (tzid, vtimezoneData, ianaName, lastModified) =>
		Effect.sync(() => {
			const existing = stores.calTimezones.get(tzid);
			const now = Temporal.Now.instant();
			const row: CalTimezoneRow = {
				id: existing?.id ?? crypto.randomUUID(),
				tzid,
				vtimezoneData,
				ianaName: Option.getOrNull(ianaName),
				lastModifiedAt: Option.getOrNull(lastModified),
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			};
			stores.calTimezones.set(tzid, row);
			return row;
		}),
});

const makeGroupRepo = (stores: TestStores): GroupRepositoryShape => ({
	findById: (id) =>
		Effect.succeed(
			Option.fromNullable(
				(() => {
					const groupRow = stores.groups.get(id);
					if (!groupRow) {
						return null;
					}
					const principal = stores.groupPrincipals.get(groupRow.principalId);
					if (!principal) {
						return null;
					}
					return { principal, group: groupRow };
				})(),
			),
		),

	create: (input) =>
		Effect.sync(() => {
			const now = Temporal.Now.instant();
			const principalId = crypto.randomUUID();
			const groupId = crypto.randomUUID();

			const principalRow: PrincipalRow = {
				id: principalId,
				principalType: "group",
				displayName: input.displayName ?? null,
				updatedAt: now,
				deletedAt: null,
				slug: input.slug,
				clientProperties: {},
			};
			const groupRow: GroupRow = {
				id: groupId,
				principalId,
				updatedAt: now,
			};

			stores.groupPrincipals.set(principalId, principalRow);
			stores.groups.set(groupId, groupRow);

			return { principal: principalRow, group: groupRow };
		}),

	update: (id, input) =>
		Effect.sync(() => {
			const groupRow = stores.groups.get(id);
			if (!groupRow) {
				throw new Error(`[TestEnv] Group not found: ${id}`);
			}
			const principal = stores.groupPrincipals.get(groupRow.principalId);
			if (!principal) {
				throw new Error(
					`[TestEnv] Group principal not found: ${groupRow.principalId}`,
				);
			}

			const now = Temporal.Now.instant();

			if (input.displayName !== undefined) {
				stores.groupPrincipals.set(groupRow.principalId, {
					...principal,
					displayName: input.displayName,
					updatedAt: now,
				});
			}

			const updatedPrincipal =
				stores.groupPrincipals.get(groupRow.principalId) ?? principal;

			return { principal: updatedPrincipal, group: groupRow };
		}),

	addMember: (groupId, userId) =>
		Effect.sync(() => {
			const members = stores.memberships.get(groupId) ?? new Set<string>();
			members.add(userId);
			stores.memberships.set(groupId, members);
		}),

	removeMember: (groupId, userId) =>
		Effect.sync(() => {
			stores.memberships.get(groupId)?.delete(userId);
		}),

	hasMember: (groupId, userId) =>
		Effect.succeed(stores.memberships.get(groupId)?.has(userId) ?? false),
});

// ---------------------------------------------------------------------------
// TestEnvBuilder
// ---------------------------------------------------------------------------

export interface TestEnvBuilder {
	/** Seed a user principal + user row with smart defaults. */
	withUser(seed?: Partial<UserSeedData>): TestEnvBuilder;
	/** Seed a collection row. ownerPrincipalId is required. */
	withCollection(seed: CollectionSeedData): TestEnvBuilder;
	/** Seed a group principal + group row with smart defaults. */
	withGroup(seed?: Partial<GroupSeedData>): TestEnvBuilder;
	/** Seed an instance row. collectionId is required. */
	withInstance(seed: InstanceSeedData): TestEnvBuilder;
	/** Seed a credential row for an existing user. */
	withCredential(seed: CredentialSeedData): TestEnvBuilder;
	/** Seed an ACE (Access Control Entry) on a resource. */
	withAce(seed: AceSeedData): TestEnvBuilder;
	/**
	 * Build a fully-wired Effect Layer from the current state of the stores.
	 * Provides UserService, CollectionService, GroupService, InstanceService,
	 * PrincipalService, AclService, and CryptoService (TestCryptoLayer).
	 */
	toLayer(): Layer.Layer<
		| UserService
		| CollectionService
		| GroupService
		| InstanceService
		| PrincipalService
		| AclService
		| AclRepository
		| PrincipalRepository
		| CryptoService
		| EntityRepository
		| ComponentRepository
		| CalTimezoneRepository
	>;
	/** Direct store access for advanced assertions. Prefer reading via services. */
	readonly stores: TestStores;
}

/**
 * Create a fresh test environment builder.
 *
 * Each call returns an independent environment with its own in-memory stores.
 * Call `makeTestEnv()` inside each `it()` block to ensure test isolation.
 *
 * @example
 * const env = makeTestEnv().withUser({ email: Email("alice@example.com") })
 * const result = await runSuccess(
 *   UserService.pipe(Effect.flatMap(s => s.findByEmail(Email("alice@example.com"))),
 *   Effect.provide(env.toLayer()))
 * )
 */
export const makeTestEnv = (): TestEnvBuilder => {
	const stores = makeStores();
	let userCounter = 0;

	const self: TestEnvBuilder = {
		stores,

		withUser(seed: Partial<UserSeedData> = {}) {
			const i = userCounter++;
			const principalId = seed.principalId ?? crypto.randomUUID();
			const userId = seed.id ?? crypto.randomUUID();
			const now = Temporal.Now.instant();

			stores.principals.set(principalId, {
				id: principalId,
				principalType: "user",
				displayName: seed.displayName ?? null,
				updatedAt: now,
				deletedAt: null,
				slug: (seed.slug ?? `test-user-${i}`) as Slug,
				clientProperties: {},
			});
			stores.users.set(userId, {
				id: userId,
				principalId,
				name: seed.name ?? `Test User ${i}`,
				email: (seed.email ?? `test${i}@example.com`) as Email,
				updatedAt: now,
			});
			return self;
		},

		withCollection(seed: CollectionSeedData) {
			const id = seed.id ?? crypto.randomUUID();
			const now = Temporal.Now.instant();
			stores.collections.set(id, {
				id,
				ownerPrincipalId: seed.ownerPrincipalId,
				collectionType: seed.collectionType ?? "calendar",
				displayName: seed.displayName ?? null,
				description: null,
				timezoneTzid: null,
				synctoken: 0,
				updatedAt: now,
				deletedAt: null,
				supportedComponents: null,
				slug: (seed.slug ?? "test-calendar") as Slug,
				parentCollectionId: null,
				clientProperties: {},
				maxResourceSize: null,
				minDateTime: null,
				maxDateTime: null,
				maxInstances: null,
				maxAttendeesPerInstance: null,
			});
			return self;
		},

		withGroup(seed: Partial<GroupSeedData> = {}) {
			const principalId = seed.principalId ?? crypto.randomUUID();
			const groupId = seed.id ?? crypto.randomUUID();
			const now = Temporal.Now.instant();

			stores.groupPrincipals.set(principalId, {
				id: principalId,
				principalType: "group",
				displayName: seed.displayName ?? null,
				updatedAt: now,
				deletedAt: null,
				slug: (seed.slug ?? "test-group") as Slug,
				clientProperties: {},
			});
			stores.groups.set(groupId, {
				id: groupId,
				principalId,
				updatedAt: now,
			});
			return self;
		},

		withInstance(seed: InstanceSeedData) {
			const id = seed.id ?? crypto.randomUUID();
			const now = Temporal.Now.instant();
			stores.instances.set(id, {
				id,
				collectionId: seed.collectionId,
				entityId: seed.entityId ?? crypto.randomUUID(),
				contentType: seed.contentType ?? "text/calendar",
				etag: seed.etag ?? `"test-etag-${id}"`,
				syncRevision: 0,
				lastModified: now,
				updatedAt: now,
				deletedAt: null,
				scheduleTag: null,
				slug: (seed.slug ?? "test-event.ics") as Slug,
				clientProperties: {},
			});
			return self;
		},

		withCredential(seed: CredentialSeedData) {
			const now = Temporal.Now.instant();
			const credRow: AuthUserRow = {
				id: crypto.randomUUID(),
				userId: seed.userId,
				authSource: seed.authSource,
				authId: seed.authId,
				updatedAt: now,
				authCredential: seed.authCredential ?? null,
			};
			stores.credentials.set(`${seed.authSource}:${seed.authId}`, credRow);
			return self;
		},

		withAce(seed: AceSeedData) {
			const now = Temporal.Now.instant();
			const existing = stores.acl.get(seed.resourceId) ?? [];
			stores.acl.set(seed.resourceId, [
				...existing,
				{
					id: crypto.randomUUID(),
					resourceType: seed.resourceType,
					resourceId: seed.resourceId,
					principalType: seed.principalType,
					principalId: seed.principalId ?? null,
					privilege: seed.privilege,
					grantDeny: seed.grantDeny ?? "grant",
					protected: seed.protected ?? false,
					ordinal: seed.ordinal ?? 0,
					updatedAt: now,
				},
			]);
			return self;
		},

		toLayer() {
			const userRepoLayer = Layer.succeed(UserRepository, makeUserRepo(stores));
			const principalRepoLayer = Layer.succeed(
				PrincipalRepository,
				makePrincipalRepo(stores),
			);
			const collectionRepoLayer = Layer.succeed(
				CollectionRepository,
				makeCollectionRepo(stores),
			);
			const instanceRepoLayer = Layer.succeed(
				InstanceRepository,
				makeInstanceRepo(stores),
			);
			const groupRepoLayer = Layer.succeed(
				GroupRepository,
				makeGroupRepo(stores),
			);
			const aclRepoLayer = Layer.succeed(AclRepository, makeAclRepo(stores));
			const entityRepoLayer = Layer.succeed(
				EntityRepository,
				makeEntityRepo(stores),
			);
			const componentRepoLayer = Layer.succeed(
				ComponentRepository,
				makeComponentRepo(stores),
			);
			const calTimezoneRepoLayer = Layer.succeed(
				CalTimezoneRepository,
				makeCalTimezoneRepo(stores),
			);

			const userServiceLayer = UserServiceLive.pipe(
				Layer.provide(
					Layer.mergeAll(userRepoLayer, TestCryptoLayer, aclRepoLayer),
				),
			);
			const principalServiceLayer = PrincipalServiceLive.pipe(
				Layer.provide(principalRepoLayer),
			);
			const collectionServiceLayer = CollectionServiceLive.pipe(
				Layer.provide(Layer.mergeAll(collectionRepoLayer, aclRepoLayer)),
			);
			const instanceServiceLayer = InstanceServiceLive.pipe(
				Layer.provide(instanceRepoLayer),
			);
			const groupServiceLayer = GroupServiceLive.pipe(
				Layer.provide(groupRepoLayer),
			);
			const aclServiceLayer = AclServiceLive.pipe(Layer.provide(aclRepoLayer));

			return Layer.mergeAll(
				TestCryptoLayer,
				userServiceLayer,
				principalServiceLayer,
				collectionServiceLayer,
				instanceServiceLayer,
				groupServiceLayer,
				aclServiceLayer,
				aclRepoLayer,
				principalRepoLayer,
				entityRepoLayer,
				componentRepoLayer,
				calTimezoneRepoLayer,
			);
		},
	};

	return self;
};
