// ---------------------------------------------------------------------------
// Test environment builder.
//
// Seeds the in-memory stores with smart defaults and hands back a fully-wired
// Effect Layer. The repository doubles and the layer wiring live in ./env/;
// this file is only the fluent seeding API on top of them.
// ---------------------------------------------------------------------------

import type { Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import type { DatabaseClient } from "#src/db/client.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import type { CryptoService } from "#src/platform/crypto.ts";
import type { AclRepository } from "#src/services/acl/repository.ts";
import type { AclService } from "#src/services/acl/service.ts";
import type { BirthdayService } from "#src/services/birthday/service.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { CollectionService } from "#src/services/collection/service.ts";
import { DEFAULT_SORT_ORDER } from "#src/services/collection/sort-order.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import type { GroupService } from "#src/services/group/service.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import type { InstanceService } from "#src/services/instance/service.ts";
import type { PrincipalRepository } from "#src/services/principal/repository.ts";
import type { PrincipalService } from "#src/services/principal/service.ts";
import type { SchedulingService } from "#src/services/scheduling/service.ts";
import type {
	CalTimezoneRepository,
	IanaTimezoneService,
} from "#src/services/timezone/index.ts";
import type { AuthUserRow } from "#src/services/user/repository.ts";
import type { UserService } from "#src/services/user/service.ts";
import { makeTestLayer } from "./env/layer.ts";
import {
	type AceSeedData,
	type CollectionSeedData,
	type CredentialSeedData,
	type GroupSeedData,
	type InstanceSeedData,
	makeStores,
	type TestStores,
	type UserSeedData,
} from "./env/stores.ts";

// ---------------------------------------------------------------------------
// TestEnvBuilder
// ---------------------------------------------------------------------------

export interface TestEnvBuilder {
	/** Seed a user principal + user row with smart defaults. */
	withUser: (seed?: Partial<UserSeedData>) => TestEnvBuilder;
	/** Seed a collection row. ownerPrincipalId is required. */
	withCollection: (seed: CollectionSeedData) => TestEnvBuilder;
	/** Seed a group principal + group row with smart defaults. */
	withGroup: (seed?: Partial<GroupSeedData>) => TestEnvBuilder;
	/** Seed an instance row. collectionId is required. */
	withInstance: (seed: InstanceSeedData) => TestEnvBuilder;
	/** Seed a credential row for an existing user. */
	withCredential: (seed: CredentialSeedData) => TestEnvBuilder;
	/** Seed an ACE (Access Control Entry) on a resource. */
	withAce: (seed: AceSeedData) => TestEnvBuilder;
	/**
	 * Build a fully-wired Effect Layer from the current state of the stores.
	 * Provides UserService, CollectionService, GroupService, InstanceService,
	 * PrincipalService, AclService, and CryptoService (TestCryptoLayer).
	 */
	toLayer: () => Layer.Layer<
		| UserService
		| CollectionService
		| GroupService
		| InstanceService
		| PrincipalService
		| AclService
		| AclRepository
		| BirthdayService
		| CollectionRepository
		| InstanceRepository
		| PrincipalRepository
		| CryptoService
		| EntityRepository
		| ExternalCalendarRepository
		| ComponentRepository
		| CalTimezoneRepository
		| CalIndexRepository
		| IanaTimezoneService
		| SchedulingService
		| DatabaseClient
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
				email: (seed.email ?? `test${i}@example.com`) as Email,
				role: seed.role ?? "normal",
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
				scheduleTransp: "opaque",
				scheduleDefaultCalendarId: null,
				autoManagedKind: null,
				sortOrder: DEFAULT_SORT_ORDER.normal,
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
				oidcGroups: seed.oidcGroups ? [...seed.oidcGroups] : [],
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
				contentLength: null,
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
				label: null,
				updatedAt: now,
				lastUsedAt: null,
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
			return makeTestLayer(stores);
		},
	};

	return self;
};
