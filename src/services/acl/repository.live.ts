import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { casbinRule } from "#src/db/drizzle/schema/index.ts";
import { databaseError } from "#src/domain/errors.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { AclRepository, type PolicyRule, type RoleRule } from "./repository.ts";

// ---------------------------------------------------------------------------
// AclRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const getRulesForResource = (db: DbClient, resourceUrl: string) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(casbinRule)
				.where(and(eq(casbinRule.ptype, "p"), eq(casbinRule.v1, resourceUrl))),
		catch: (e) => databaseError(e),
	});

const insertRule = (db: DbClient, rule: PolicyRule | RoleRule) =>
	Effect.tryPromise({
		try: () => {
			if (rule.ptype === "p") {
				return db
					.insert(casbinRule)
					.values({
						ptype: "p",
						v0: rule.subject,
						v1: rule.resource,
						v2: rule.privilege,
						v3: rule.effect,
						v4: "",
						v5: "",
					})
					.then(() => undefined);
			}
			return db
				.insert(casbinRule)
				.values({
					ptype: "g",
					v0: rule.user,
					v1: rule.role,
					v2: "",
					v3: "",
					v4: "",
					v5: "",
				})
				.then(() => undefined);
		},
		catch: (e) => databaseError(e),
	});

const deleteRulesForResource = (db: DbClient, resourceUrl: string) =>
	Effect.tryPromise({
		try: () =>
			db
				.delete(casbinRule)
				.where(and(eq(casbinRule.ptype, "p"), eq(casbinRule.v1, resourceUrl)))
				.then(() => undefined),
		catch: (e) => databaseError(e),
	});

const hasAllow = (
	db: DbClient,
	subject: string,
	resourceUrl: string,
	privilege: DavPrivilege,
) =>
	Effect.tryPromise({
		try: () =>
			db
				.select({ id: casbinRule.id })
				.from(casbinRule)
				.where(
					and(
						eq(casbinRule.ptype, "p"),
						eq(casbinRule.v0, subject),
						eq(casbinRule.v1, resourceUrl),
						eq(casbinRule.v2, privilege),
						eq(casbinRule.v3, "allow"),
					),
				)
				.limit(1)
				.then((r) => r.length > 0),
		catch: (e) => databaseError(e),
	});

const getAllRules = (db: DbClient) =>
	Effect.tryPromise({
		try: () => db.select().from(casbinRule),
		catch: (e) => databaseError(e),
	});

export const AclRepositoryLive = Layer.effect(
	AclRepository,
	Effect.map(DatabaseClient, (db) =>
		AclRepository.of({
			getAllRules: () => getAllRules(db),
			getRulesForResource: (url) => getRulesForResource(db, url),
			insertRule: (rule) => insertRule(db, rule),
			deleteRulesForResource: (url) => deleteRulesForResource(db, url),
			hasAllow: (sub, url, priv) => hasAllow(db, sub, url, priv),
		}),
	),
);
