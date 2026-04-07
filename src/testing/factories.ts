import { Redacted } from "effect";
import { Temporal } from "temporal-polyfill";
import type { UuidString } from "#src/domain/ids.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import type {
	GroupRow,
	GroupWithPrincipal,
} from "#src/services/group/repository.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import type {
	PrincipalRow,
	UserRow,
} from "#src/services/principal/repository.ts";
import type {
	AuthUserRow,
	UserWithPrincipal,
} from "#src/services/user/repository.ts";

// ---------------------------------------------------------------------------
// Test row factories
//
// Each factory accepts optional overrides and fills in sensible defaults.
// All timestamps use Temporal.Now.instant() unless overridden.
// ---------------------------------------------------------------------------

const now = (): Temporal.Instant => Temporal.Now.instant();

export const makePrincipalRow = (
	overrides: Partial<PrincipalRow> = {},
): PrincipalRow => ({
	id: crypto.randomUUID(),
	principalType: "user",
	displayName: null,
	updatedAt: now(),
	deletedAt: null,
	slug: "test-user",
	...overrides,
});

export const makeUserRow = (
	principalId: UuidString,
	overrides: Partial<UserRow> = {},
): UserRow => ({
	id: crypto.randomUUID(),
	principalId,
	name: "Test User",
	email: "test@example.com",
	updatedAt: now(),
	...overrides,
});

export const makeUserWithPrincipal = (
	overrides: {
		principal?: Partial<PrincipalRow>;
		user?: Partial<UserRow>;
	} = {},
): UserWithPrincipal => {
	const principal = makePrincipalRow(overrides.principal);
	const user = makeUserRow(principal.id, overrides.user);
	return { principal, user };
};

export const makeAuthUserRow = (
	userId: UuidString,
	overrides: Partial<AuthUserRow> = {},
): AuthUserRow => ({
	id: crypto.randomUUID(),
	userId,
	authSource: "local",
	authId: "testuser",
	updatedAt: now(),
	authCredential: Redacted.make("test:password"),
	...overrides,
});

export const makeCollectionRow = (
	ownerPrincipalId: UuidString,
	overrides: Partial<CollectionRow> = {},
): CollectionRow => ({
	id: crypto.randomUUID(),
	ownerPrincipalId,
	collectionType: "calendar",
	displayName: null,
	description: null,
	timezoneTzid: null,
	synctoken: 0,
	updatedAt: now(),
	deletedAt: null,
	supportedComponents: null,
	slug: "test-calendar",
	parentCollectionId: null,
	clientProperties: {},
	maxResourceSize: null,
	minDateTime: null,
	maxDateTime: null,
	maxInstances: null,
	maxAttendeesPerInstance: null,
	...overrides,
});

export const makeInstanceRow = (
	collectionId: UuidString,
	overrides: Partial<InstanceRow> = {},
): InstanceRow => ({
	id: crypto.randomUUID(),
	collectionId,
	entityId: crypto.randomUUID(),
	contentType: "text/calendar",
	etag: `"test-etag-${crypto.randomUUID()}"`,
	syncRevision: 0,
	lastModified: now(),
	updatedAt: now(),
	deletedAt: null,
	scheduleTag: null,
	slug: "test-event.ics",
	clientProperties: {},
	...overrides,
});

export const makeGroupPrincipalRow = (
	overrides: Partial<PrincipalRow> = {},
): PrincipalRow => ({
	id: crypto.randomUUID(),
	principalType: "group",
	displayName: null,
	updatedAt: now(),
	deletedAt: null,
	slug: "test-group",
	...overrides,
});

export const makeGroupRow = (
	principalId: UuidString,
	overrides: Partial<GroupRow> = {},
): GroupRow => ({
	id: crypto.randomUUID(),
	principalId,
	updatedAt: now(),
	...overrides,
});

export const makeGroupWithPrincipal = (
	overrides: {
		principal?: Partial<PrincipalRow>;
		group?: Partial<GroupRow>;
	} = {},
): GroupWithPrincipal => {
	const principal = makeGroupPrincipalRow(overrides.principal);
	const group = makeGroupRow(principal.id, overrides.group);
	return { principal, group };
};
