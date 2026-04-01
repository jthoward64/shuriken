import { newEnforcer, newModelFromString, StringAdapter } from "casbin";
import { Effect, Layer } from "effect";
import { needPrivileges } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { AclRepository, type CasbinRuleRow } from "./repository.ts";
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

// Static rules that never change — kept here rather than seeded in the DB so
// the enforcer works correctly even on a fresh database.
//
// g2: leaf → aggregate containment (DAV:write-content is contained by DAV:write, etc.)
// g:  pseudo-principal chain (DAV:authenticated and DAV:unauthenticated both
//     inherit from DAV:all)
const STATIC_RULES = `
g2, DAV:write-properties, DAV:write
g2, DAV:write-content, DAV:write
g2, DAV:bind, DAV:write
g2, DAV:unbind, DAV:write
g2, DAV:read, DAV:all
g2, DAV:write, DAV:all
g2, DAV:write-properties, DAV:all
g2, DAV:write-content, DAV:all
g2, DAV:bind, DAV:all
g2, DAV:unbind, DAV:all
g2, DAV:unlock, DAV:all
g2, DAV:read-acl, DAV:all
g2, DAV:read-current-user-privilege-set, DAV:all
g2, DAV:write-acl, DAV:all
g, DAV:authenticated, DAV:all
g, DAV:unauthenticated, DAV:all
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format the casbin subject for a stored principal UUID. */
const principalSubject = (id: PrincipalId): string => `principal:${id}`;

/** Convert one casbin_rule DB row to a CSV policy line for StringAdapter. */
const ruleToLine = (row: CasbinRuleRow): string => {
	switch (row.ptype) {
		case "p":
			return `p, ${row.v0}, ${row.v1}, ${row.v2}, ${row.v3}, ${row.v4}`;
		case "g":
			return `g, ${row.v0}, ${row.v1}`;
		case "g2":
			return `g2, ${row.v0}, ${row.v1}`;
		default:
			return "";
	}
};

/**
 * Build a per-request in-memory Casbin enforcer.
 *
 * Failures are treated as defects (programming errors) — a malformed model
 * string or corrupt DB row should never occur in normal operation.
 */
const buildEnforcer = (rules: ReadonlyArray<CasbinRuleRow>, subject: string) =>
	// Effect.promise turns any rejection into a defect — appropriate here because
	// failures indicate a malformed model string or corrupt DB data, neither of
	// which is recoverable at the call site.
	Effect.promise(async () => {
		const model = newModelFromString(MODEL_TEXT);
		const policyLines = rules
			.map(ruleToLine)
			.filter((l) => l.length > 0)
			.join("\n");
		const adapter = new StringAdapter(`${STATIC_RULES}\n${policyLines}`);
		const enforcer = await newEnforcer(model, adapter);
		// Add the session-scoped DAV:authenticated role for the current principal.
		// This is transient — not stored in the DB — as specified in the planning doc.
		await enforcer.addRoleForUser(subject, "DAV:authenticated");
		return enforcer;
	});

// ---------------------------------------------------------------------------
// AclService live implementation
// ---------------------------------------------------------------------------

export const AclServiceLive = Layer.effect(
	AclService,
	Effect.gen(function* () {
		const repo = yield* AclRepository;

		return AclService.of({
			check: (
				principalId: PrincipalId,
				resourceUrl: string,
				privilege: DavPrivilege,
			) =>
				Effect.gen(function* () {
					const rules = yield* repo.getAllRules();
					const subject = principalSubject(principalId);
					const enforcer = yield* buildEnforcer(rules, subject);
					const allowed = yield* Effect.promise(() =>
						enforcer.enforce(subject, resourceUrl, privilege),
					);
					if (!allowed) {
						return yield* Effect.fail(needPrivileges());
					}
				}),

			currentUserPrivileges: (principalId: PrincipalId, resourceUrl: string) =>
				Effect.gen(function* () {
					const rules = yield* repo.getAllRules();
					const subject = principalSubject(principalId);
					const enforcer = yield* buildEnforcer(rules, subject);
					const results = yield* Effect.all(
						ALL_PRIVILEGES.map((priv) =>
							Effect.promise(() =>
								enforcer.enforce(subject, resourceUrl, priv),
							).pipe(Effect.map((allowed) => (allowed ? priv : null))),
						),
						{ concurrency: "unbounded" },
					);
					return results.filter((p): p is DavPrivilege => p !== null);
				}),
		});
	}),
);

export { needPrivileges } from "#src/domain/errors.ts";
