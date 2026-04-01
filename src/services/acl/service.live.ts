import { newEnforcer, newModelFromString } from "casbin";
import DrizzleAdapter, { type DrizzleAdapterOptions } from "drizzle-adapter";
import { Array as Arr, Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { casbinRule } from "#src/db/drizzle/schema.ts";
import { needPrivileges } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { ResourceUrl } from "#src/domain/types/path.ts";
import { AclService } from "./service.ts";

// ---------------------------------------------------------------------------
// Casbin model — WebDAV ACL (RFC 3744)
// ---------------------------------------------------------------------------

const MODEL_TEXT = `
[request_definition]
r = sub, res, act

[policy_definition]
p = sub, res, act, eft, priority

[role_definition]
g = _, _
g2 = _, _

[policy_effect]
e = priority(p.eft) || deny

[matchers]
m = (g(r.sub, p.sub) || r.sub == p.sub) && globMatch(r.res, p.res) && (r.act == p.act || g2(r.act, p.act))
`;

// Full set of privileges to enumerate for currentUserPrivileges.
const ALL_PRIVILEGES: ReadonlyArray<DavPrivilege> = [
	"DAV:read",
	"DAV:write",
	"DAV:write-properties",
	"DAV:write-content",
	"DAV:unlock",
	"DAV:read-acl",
	"DAV:read-current-user-privilege-set",
	"DAV:write-acl",
	"DAV:bind",
	"DAV:unbind",
	"DAV:all",
	"CALDAV:schedule-deliver",
	"CALDAV:schedule-deliver-invite",
	"CALDAV:schedule-deliver-reply",
	"CALDAV:schedule-query-freebusy",
	"CALDAV:schedule-send",
	"CALDAV:schedule-send-invite",
	"CALDAV:schedule-send-reply",
	"CALDAV:schedule-send-freebusy",
];

/** Format the casbin subject for a stored principal UUID. */
const principalSubject = (id: PrincipalId): string => `principal:${id}`;

export const AclServiceLive = Layer.effect(
	AclService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;

		const enforcer = yield* Effect.promise(async () => {
			const adapter = await DrizzleAdapter.newAdapter({
				db,
				// Our schema uses text columns rather than varchar, so it is not in
				// the adapter's closed table-type union. Column names are identical,
				// making the cast safe at runtime.
				table: casbinRule as unknown as DrizzleAdapterOptions["table"],
			});
			return newEnforcer(newModelFromString(MODEL_TEXT), adapter);
		});

		return AclService.of({
			check: (
				principalId: PrincipalId,
				resourceUrl: ResourceUrl,
				privilege: DavPrivilege,
			) =>
				Effect.gen(function* () {
					const subject = principalSubject(principalId);
					yield* Effect.promise(() =>
						enforcer.addRoleForUser(subject, "DAV:authenticated"),
					);
					const allowed = yield* Effect.promise(() =>
						enforcer.enforce(subject, resourceUrl, privilege),
					);
					if (!allowed) {
						return yield* Effect.fail(needPrivileges());
					}
				}),

			currentUserPrivileges: (
				principalId: PrincipalId,
				resourceUrl: ResourceUrl,
			) =>
				Effect.gen(function* () {
					const subject = principalSubject(principalId);
					yield* Effect.promise(() =>
						enforcer.addRoleForUser(subject, "DAV:authenticated"),
					);
					const results = yield* Effect.all(
						ALL_PRIVILEGES.map((priv) =>
							Effect.promise(() =>
								enforcer.enforce(subject, resourceUrl, priv),
							).pipe(
								Effect.map((allowed) =>
									allowed ? Option.some(priv) : Option.none(),
								),
							),
						),
						{ concurrency: "unbounded" },
					);
					return Arr.filterMap(results, (x) => x);
				}),
		});
	}),
);

export { needPrivileges } from "#src/domain/errors.ts";
