import { type SQL, and, eq, inArray, or, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import {
	davAcl,
	group,
	membership,
	user,
} from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import {
	AclRepository,
	type AclResourceType,
	type NewAce,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// AclRepository — Drizzle implementation over dav_acl
// ---------------------------------------------------------------------------

const getAces = (db: DbClient, resourceId: string, resourceType: AclResourceType) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(davAcl)
				.where(
					and(eq(davAcl.resourceId, resourceId), eq(davAcl.resourceType, resourceType)),
				)
				.orderBy(davAcl.ordinal),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const setAces = (
	db: DbClient,
	resourceId: string,
	resourceType: AclResourceType,
	aces: ReadonlyArray<NewAce>,
) =>
	Effect.tryPromise({
		try: () =>
			db.transaction(async (tx) => {
				// Delete all non-protected ACEs for this resource
				await tx
					.delete(davAcl)
					.where(
						and(
							eq(davAcl.resourceId, resourceId),
							eq(davAcl.resourceType, resourceType),
							eq(davAcl.protected, false),
						),
					);
				// Insert the new ACEs (skip if empty)
				if (aces.length > 0) {
					await tx.insert(davAcl).values(
						aces.map((ace) => ({
							resourceType: ace.resourceType,
							resourceId: ace.resourceId,
							principalType: ace.principalType,
							principalId: ace.principalId ?? null,
							privilege: ace.privilege,
							grantDeny: ace.grantDeny,
							protected: ace.protected,
							ordinal: ace.ordinal,
						})),
					);
				}
			}),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const grantAce = (db: DbClient, ace: NewAce) =>
	Effect.tryPromise({
		try: () =>
			db
				.insert(davAcl)
				.values({
					resourceType: ace.resourceType,
					resourceId: ace.resourceId,
					principalType: ace.principalType,
					principalId: ace.principalId ?? null,
					privilege: ace.privilege,
					grantDeny: ace.grantDeny,
					protected: ace.protected,
					ordinal: ace.ordinal,
				})
				.then(() => undefined),
		catch: (e) => new DatabaseError({ cause: e }),
	});

// ---------------------------------------------------------------------------
// Principal filter helper
//
// Matches rows where:
//   principal_type = 'all'                                    (always)
//   principal_type = 'authenticated'  AND caller is authed    (when isAuthenticated)
//   principal_type = 'unauthenticated' AND caller is not authed
//   principal_type = 'principal'      AND principal_id in set
// ---------------------------------------------------------------------------

function buildPrincipalFilter(
	principalIds: ReadonlyArray<PrincipalId>,
	isAuthenticated: boolean,
): SQL {
	const conditions: Array<SQL> = [sql`${davAcl.principalType} = 'all'`];

	if (isAuthenticated) {
		conditions.push(sql`${davAcl.principalType} = 'authenticated'`);
	} else {
		conditions.push(sql`${davAcl.principalType} = 'unauthenticated'`);
	}

	if (principalIds.length > 0) {
		conditions.push(
			sql`(${davAcl.principalType} = 'principal' AND ${davAcl.principalId} = ANY(${principalIds}))`,
		);
	}

	return or(...conditions) as SQL;
}

const hasPrivilege = (
	db: DbClient,
	principalIds: ReadonlyArray<PrincipalId>,
	resourceId: string,
	privileges: ReadonlyArray<DavPrivilege>,
	isAuthenticated: boolean,
) =>
	Effect.tryPromise({
		try: () =>
			db
				.select({ id: davAcl.id })
				.from(davAcl)
				.where(
					and(
						eq(davAcl.resourceId, resourceId),
						eq(davAcl.grantDeny, "grant"),
						inArray(davAcl.privilege, privileges as Array<DavPrivilege>),
						buildPrincipalFilter(principalIds, isAuthenticated),
					),
				)
				.limit(1)
				.then((r) => r.length > 0),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const getGrantedPrivileges = (
	db: DbClient,
	principalIds: ReadonlyArray<PrincipalId>,
	resourceId: string,
	isAuthenticated: boolean,
) =>
	Effect.tryPromise({
		try: () =>
			db
				.selectDistinct({ privilege: davAcl.privilege })
				.from(davAcl)
				.where(
					and(
						eq(davAcl.resourceId, resourceId),
						eq(davAcl.grantDeny, "grant"),
						buildPrincipalFilter(principalIds, isAuthenticated),
					),
				)
				.then((rows) => rows.map((r) => r.privilege as DavPrivilege)),
		catch: (e) => new DatabaseError({ cause: e }),
	});

// Resolve all group principal IDs for a given user principal.
// Used by the service to expand the principal set before privilege checks.
const getGroupPrincipalIds = (db: DbClient, userPrincipalId: PrincipalId) =>
	Effect.tryPromise({
		try: () =>
			db
				.select({ principalId: group.principalId })
				.from(group)
				.innerJoin(membership, eq(membership.groupId, group.id))
				.innerJoin(user, eq(user.id, membership.userId))
				.where(eq(user.principalId, userPrincipalId))
				.then((rows) => rows.map((r) => r.principalId as PrincipalId)),
		catch: (e) => new DatabaseError({ cause: e }),
	});

export const AclRepositoryLive = Layer.effect(
	AclRepository,
	Effect.map(DatabaseClient, (db) =>
		AclRepository.of({
			getAces: (resourceId, resourceType) =>
				getAces(db, resourceId, resourceType),
			setAces: (resourceId, resourceType, aces) =>
				setAces(db, resourceId, resourceType, aces),
			grantAce: (ace) => grantAce(db, ace),
			hasPrivilege: (principalIds, resourceId, privileges, isAuthenticated) =>
				hasPrivilege(db, principalIds, resourceId, privileges, isAuthenticated),
			getGrantedPrivileges: (principalIds, resourceId, isAuthenticated) =>
				getGrantedPrivileges(db, principalIds, resourceId, isAuthenticated),
			getGroupPrincipalIds: (userPrincipalId) =>
				getGroupPrincipalIds(db, userPrincipalId),
		}),
	),
);
