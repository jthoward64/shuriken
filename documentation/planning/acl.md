# Casbin Model Proposal: WebDAV ACL (RFC 3744)

## Overview

This document proposes a Casbin model that implements the WebDAV Access Control
Protocol as specified in RFC 3744. The model must capture ordered ACE evaluation,
grant/deny semantics, aggregate privileges, recursive group membership, and the
full set of pseudo-principals defined by the spec.

---

## RFC 3744 Concepts Summary

### Principals (§2, §5.5.1)

A principal is any network resource that initiates access. The spec defines several
types that can appear in an ACE:

| Principal type     | Meaning                                                              |
|--------------------|----------------------------------------------------------------------|
| `href`             | A specific named principal (user or group URL)                       |
| `DAV:all`          | Every principal — always matches                                     |
| `DAV:authenticated`| Any principal that has authenticated                                 |
| `DAV:unauthenticated` | Any principal that has not authenticated                          |
| `DAV:self`         | Only when the resource being accessed IS the principal itself        |
| `DAV:property`     | The principal identified by a named property of the resource (e.g., `DAV:owner`) |
| `invert(principal)`| Any principal that does NOT match the wrapped principal             |

Groups are principals that contain other principals. Membership is recursive: if
`alice` is in `engineers`, and `engineers` is in `staff`, then `alice` also matches
`staff`.

### Privileges (§3)

Privileges form a containment hierarchy. An aggregate privilege contains others; granting
the aggregate is semantically identical to granting each contained privilege individually.

```
DAV:all
├── DAV:read
│   (controls: GET, HEAD, OPTIONS, PROPFIND)
├── DAV:write
│   ├── DAV:write-properties   (controls: PROPPATCH, CHECKOUT, CHECKIN, VERSION-CONTROL)
│   ├── DAV:write-content      (controls: PUT on existing target, LOCK on existing, MERGE)
│   ├── DAV:bind               (controls: PUT new, MKCOL, LOCK new, COPY to collection, MOVE to collection)
│   └── DAV:unbind             (controls: DELETE, MOVE from collection)
├── DAV:unlock                 (controls: UNLOCK by non-lock-owner)
├── DAV:read-acl               (controls: PROPFIND for DAV:acl)
├── DAV:read-current-user-privilege-set  (controls: PROPFIND for DAV:current-user-privilege-set)
└── DAV:write-acl              (controls: ACL method)
```

The RFC's aggregation constraints (§3.12) forbid certain containment combinations —
e.g., `DAV:read-acl` MUST NOT contain `DAV:read`, and `DAV:write` MUST contain
`DAV:bind`, `DAV:unbind`, `DAV:write-properties`, and `DAV:write-content`.

Privileges may be declared **abstract** for a given resource, meaning they cannot
appear directly in an ACE on that resource. Abstract privilege enforcement is
resource-specific and must be handled at the application layer before Casbin
evaluation.

### ACL and ACE Structure (§5.5)

Each resource has a `DAV:acl` property — an ordered list of ACEs. Each ACE specifies:

- A **principal** (who it applies to)
- A **grant** or **deny** (the effect)
- A set of **privileges** (which operations)
- Optionally: `protected` (cannot be removed) and/or `inherited` (from a parent resource)

```
ACL = [ACE₁, ACE₂, ..., ACEₙ]
ACE = (principal, grant|deny, {privileges...}, [protected], [inherited])
```

### ACL Evaluation (§6)

Evaluation is **ordered** and **per-privilege**. For a request requiring privilege set
`P`:

1. Iterate ACEs in order.
2. For each ACE whose principal matches the current user:
   - If it is a **grant** ACE: add the granted privileges to the "granted" set.
   - If it is a **deny** ACE for a privilege in `P` that has not yet been granted:
     terminate evaluation → **access denied**.
3. If all privileges in `P` are in the granted set → **access granted**.
4. Otherwise → **access denied**.

This is a **first-applicable** model: the first ACE to either complete the grant
set or introduce a relevant deny determines the outcome. Importantly, a deny ACE
only stops evaluation if the denied privilege is still needed; if it was already
granted by an earlier ACE, the deny has no effect.

### Inherited ACL Set (§5.7)

A resource may have a `DAV:inherited-acl-set` property pointing to other resources
whose ACLs must **also** grant the required privileges. Privileges granted by the
resource's own ACL are ANDed with privileges granted by each inherited ACL. This
is evaluated at the application layer.

---

## Casbin Model Design

### Policy Representation

Each ACE is expanded into one Casbin policy row **per concrete privilege** (aggregates
are expanded into their leaves). The ACE's position in the ACL list becomes the
`priority` field (lower = higher priority = evaluated first).

**Policy tuple**: `(principal, resource, privilege, effect, priority)`

```ini
[policy_definition]
p = sub, res, act, eft, priority
```

Example ACL for resource `/papers/`:
```
# ACE 1: grant gstein read (priority 10)
p, principal:gstein,        /papers/, DAV:read,             allow, 10
# ACE 2: deny mrktng read (priority 20)
p, principal:group:mrktng,  /papers/, DAV:read,             deny,  20
# ACE 3: grant owner read-acl and write-acl (property principal, resolved before storage)
p, principal:gstein,        /papers/, DAV:read-acl,         allow, 30
p, principal:gstein,        /papers/, DAV:write-acl,        allow, 30
# ACE 4 (inherited): grant DAV:all read (from /top, priority 40)
p, DAV:all,                 /papers/, DAV:read,             allow, 40
```

Aggregate privileges in an ACE are expanded to their constituent non-abstract
privileges at write time (when the ACL method stores ACEs). The stored policy
only contains concrete leaf privileges. This avoids the need for aggregate
expansion at query time and keeps the matcher simple.

### Role Definitions

Two role hierarchies are used.

#### `g` — Principal Group Membership and Pseudo-principal Membership

```ini
[role_definition]
g = _, _
```

Group membership is stored as Casbin role assignments. Because Casbin's role
resolution is recursive, nested groups work automatically.

```
# Group membership
g, principal:alice,            principal:group:engineers
g, principal:group:engineers,  principal:group:staff

# Authenticated principals (populated at runtime by the application)
g, principal:alice,            DAV:authenticated
g, principal:bob,              DAV:authenticated

# Pseudo-principal hierarchy (static, configured once)
g, DAV:authenticated,          DAV:all
g, DAV:unauthenticated,        DAV:all
```

`DAV:self` and `DAV:property` principal types are not stored as Casbin roles —
they require property lookups that the application must resolve before querying
Casbin (see §Application Responsibilities below).

#### `g2` — Privilege Containment (static, configured once)

```ini
[role_definition]
g2 = _, _
```

The hierarchy is stored with **leaf → aggregate** direction, meaning "this leaf
inherits from this aggregate". This allows the matcher to check whether a policy
granting an aggregate also satisfies a request for a leaf privilege.

```
# write aggregates: write-properties, write-content, bind, unbind
g2, DAV:write-properties,                       DAV:write
g2, DAV:write-content,                          DAV:write
g2, DAV:bind,                                   DAV:write
g2, DAV:unbind,                                 DAV:write

# all aggregates everything
g2, DAV:read,                                   DAV:all
g2, DAV:write,                                  DAV:all
g2, DAV:write-properties,                       DAV:all
g2, DAV:write-content,                          DAV:all
g2, DAV:bind,                                   DAV:all
g2, DAV:unbind,                                 DAV:all
g2, DAV:unlock,                                 DAV:all
g2, DAV:read-acl,                               DAV:all
g2, DAV:read-current-user-privilege-set,        DAV:all
g2, DAV:write-acl,                              DAV:all
```

Since ACEs are expanded to leaf privileges at write time, the `g2` hierarchy is
used to allow a **policy row containing an aggregate** to match a **request for a
leaf**. In practice this only occurs if an administrator inserts raw policy rows.
The standard write path (ACL method handler) always expands, making `g2` a
safety net rather than the primary expansion mechanism.

### Request Definition

```ini
[request_definition]
r = sub, res, act
```

- `r.sub` — the authenticated principal's identifier (e.g., `principal:alice`)
- `r.res` — the target resource URL/path (e.g., `/papers/`)
- `r.act` — the WebDAV privilege being checked (e.g., `DAV:write-content`)

### Policy Effect

```ini
[policy_effect]
e = priority(p.eft) == allow
```

The Casbin `priority` effect evaluates policies in ascending priority order. The
first matching policy row determines the outcome. This directly implements the
RFC's first-applicable ordered ACE evaluation.

### Matchers

```ini
[matchers]
m = (g(r.sub, p.sub) || r.sub == p.sub) \
    && keyMatch2(r.res, p.res) \
    && (r.act == p.act || g2(r.act, p.act))
```

Breakdown:
- `g(r.sub, p.sub) || r.sub == p.sub` — the requesting principal is the named principal or a member of it (direct or transitive group membership). Because `DAV:authenticated` and `DAV:unauthenticated` are loaded as roles of real principals, they are matched here automatically. `DAV:all` matches everyone because all principals ultimately inherit `DAV:all` via `g`.
- `keyMatch2(r.res, p.res)` — resource path matching; supports wildcards for collection-level policies (e.g., `/papers/{*}` to cover all members of a collection).
- `r.act == p.act || g2(r.act, p.act)` — the requested privilege is the same as the policy privilege, or the requested privilege is a sub-privilege of an aggregate granted by the policy.

---

## Full Model Configuration File

```ini
[request_definition]
r = sub, res, act

[policy_definition]
p = sub, res, act, eft, priority

[role_definition]
g = _, _
g2 = _, _

[policy_effect]
e = priority(p.eft) == allow

[matchers]
m = (g(r.sub, p.sub) || r.sub == p.sub) \
    && keyMatch2(r.res, p.res) \
    && (r.act == p.act || g2(r.act, p.act))
```

---

## Application Responsibilities

The following RFC 3744 semantics cannot be fully expressed in the Casbin policy
model and must be handled by the application layer surrounding Casbin.

### 1. DAV:self Principal Resolution

`DAV:self` in an ACE means the resource being accessed is itself a principal, and
the request is being made by (or on behalf of) that same principal or one of its
members. The application must:

1. Determine whether `r.res` is a principal resource.
2. If so, check whether `r.sub` matches that principal (or is a member of it).
3. If matched, inject a role assignment `g(r.sub, "DAV:self:<resource>")` into the
   transient request context, and store the ACE with that synthetic principal.

### 2. DAV:property Principal Resolution

`DAV:property` ACEs grant/deny based on the value of a named property of the
resource. The most common case is `DAV:owner`. The application must:

1. Retrieve the value of the specified property from the resource.
2. Resolve the principal URL found in the property value.
3. Rewrite the ACE's principal to the concrete principal identifier before policy
   storage, or resolve it at query time and synthesize a transient role.

Recommended: resolve `DAV:property` principals at ACE storage time (when `ACL`
method is called) and store the resolved principal URL directly. Re-resolve on
`PROPPATCH` of the relevant property.

### 3. DAV:invert Principal Negation

`DAV:invert(principal)` means the ACE applies to principals that do NOT match.
Casbin does not support negated role membership in matchers across general policy
rows. The application must:

1. Check server `DAV:acl-restrictions`. If `DAV:no-invert` is set, reject inverted
   ACEs.
2. For servers that allow `DAV:invert`, handle inverted ACEs in application code
   before delegating to Casbin, or model them as separate explicit deny rows for
   all known principals except the inverted one (expensive and fragile).
3. Recommended approach: evaluate inverted ACEs entirely in application code and
   pass only the computed `allow`/`deny` result for the inversion check alongside
   the normal Casbin query for remaining ACEs.

### 4. DAV:inherited-acl-set (AND Semantics)

The `DAV:inherited-acl-set` property identifies resources whose ACLs gate access
in addition to the resource's own ACL. The application must:

1. Retrieve `DAV:inherited-acl-set` for the target resource.
2. For each URL in that set, perform an independent Casbin query against that
   resource's ACL with the same subject and privilege.
3. Only grant access if ALL queries return `allow`.

Inherited ACEs that appear inline in `DAV:acl` (tagged with `DAV:inherited`) are
already represented as normal policy rows (with the appropriate priority). The
`DAV:inherited-acl-set` AND check is a separate evaluation step on top of this.

### 5. Abstract Privilege Enforcement

Before writing an ACE via the `ACL` method, the application must validate that no
privilege in the ACE is declared abstract for the target resource. Attempting to
set an abstract privilege must return `403 Forbidden` with `DAV:no-abstract`.

### 6. Multi-Resource Privilege Checks (COPY, MOVE)

Some HTTP methods require privileges on multiple resources simultaneously (§7.3,
§7.4, Appendix B). For example:

- `MOVE /a/b → /c/d` requires `DAV:unbind` on `/a/` AND `DAV:bind` on `/c/`.
- `COPY /src → /dst` (target exists) requires `DAV:read` on `/src`, plus
  `DAV:write-content` and `DAV:write-properties` on `/dst`.

The application must issue multiple Casbin queries (one per resource+privilege pair)
and deny access if any single check fails.

### 7. ACL Method Preconditions (§8.1.1)

These validation conditions must be enforced by the application before committing
policy changes:

| Precondition                    | Description |
|---------------------------------|-------------|
| `DAV:no-ace-conflict`           | No two ACEs in the submitted list may conflict (implementation-defined; at minimum, no duplicate principal+privilege combinations in the same ACE direction) |
| `DAV:no-protected-ace-conflict` | Submitted ACL must not contradict any protected ACE |
| `DAV:no-inherited-ace-conflict` | Submitted ACL must not contradict any inherited ACE |
| `DAV:limited-number-of-aces`    | Server limit on ACE count per resource |
| `DAV:grant-only`                | If `DAV:acl-restrictions` contains `DAV:grant-only`, deny ACEs are forbidden |
| `DAV:no-invert`                 | If `DAV:acl-restrictions` contains `DAV:no-invert`, inverted ACEs are forbidden |
| `DAV:deny-before-grant`         | If set, deny ACEs must appear before grant ACEs in the list |
| `DAV:no-abstract`               | Privileges in ACEs must not be abstract for this resource |
| `DAV:not-supported-privilege`   | Privileges in ACEs must appear in `DAV:supported-privilege-set` |
| `DAV:missing-required-principal`| `DAV:acl-restrictions`/`required-principal` constraint — the ACL must contain at least one ACE for the required principals |
| `DAV:recognized-principal`      | All principals named in ACEs must be recognized by the server |
| `DAV:allowed-principal`         | If the server restricts which principals can appear in ACEs, the submitted principals must be in the allowed set |

### 8. Owner Privilege Bypass

The lock owner can always `UNLOCK` their own lock regardless of `DAV:unlock`
privilege. The application must check lock ownership before consulting Casbin for
`UNLOCK` requests.

---

## Policy Storage Mapping to the Casbin Schema

The existing `casbin_rule` table already provides the `ptype`, `v0`–`v5` columns
used by Casbin's standard SQL adapter. The mapping is:

| Column  | Value for `p` rules        | Value for `g` rules           | Value for `g2` rules         |
|---------|----------------------------|-------------------------------|------------------------------|
| `ptype` | `"p"`                      | `"g"`                         | `"g2"`                       |
| `v0`    | principal (sub)            | child principal               | child privilege              |
| `v1`    | resource path/pattern      | parent principal / pseudo     | parent privilege             |
| `v2`    | privilege (act)            | —                             | —                            |
| `v3`    | effect (`"allow"`/`"deny"`)| —                             | —                            |
| `v4`    | priority (integer as text) | —                             | —                            |
| `v5`    | — (reserved)               | —                             | —                            |

Priority values for `p` rows should be allocated in increments (e.g., 10, 20, 30…)
to allow later insertion of ACEs without a full renumber. Renumbering is required
when an ACE is inserted between two existing entries with adjacent priorities.

---

## Example: Full ACL Walk-through

Given the ACL from RFC 3744 §5.5.5:

```
ACE 1: grant gstein         DAV:read
ACE 2: deny  group:mrktng   DAV:read
ACE 3: grant <owner>        DAV:read-acl, DAV:write-acl  (property principal)
ACE 4: grant DAV:all        DAV:read                     (inherited from /top)
```

After expansion and property resolution (assuming `<owner>` = `gstein`), the
stored policy rows are:

```
p, principal:gstein,         /papers/,  DAV:read,       allow,  10
p, principal:group:mrktng,   /papers/,  DAV:read,       deny,   20
p, principal:gstein,         /papers/,  DAV:read-acl,   allow,  30
p, principal:gstein,         /papers/,  DAV:write-acl,  allow,  30
p, DAV:all,                  /papers/,  DAV:read,       allow,  40
```

Role definitions:

```
g, principal:gstein,          principal:group:authors
g, principal:bob,             principal:group:mrktng
g, principal:gstein,          DAV:authenticated
g, principal:bob,             DAV:authenticated
g, DAV:authenticated,         DAV:all
g, DAV:unauthenticated,       DAV:all
```

Query `(principal:gstein, /papers/, DAV:read)`:
1. Row priority 10: `g(gstein, gstein)` = true, res matches, act matches → **allow** → evaluation stops.

Query `(principal:bob, /papers/, DAV:read)`:
1. Row priority 10: `g(bob, gstein)` = false, skip.
2. Row priority 20: `g(bob, group:mrktng)` = true, res matches, act matches → **deny** → evaluation stops.

Query `(principal:anonymous, /papers/, DAV:read)` (anonymous is unauthenticated):
1. Rows 10, 20, 30: no match.
2. Row priority 40: `g(anonymous, DAV:all)` — the application adds `g(anonymous, DAV:unauthenticated)` at session start, and `g(DAV:unauthenticated, DAV:all)` is always present → transitively `g(anonymous, DAV:all)` = true → **allow**.

---

## Open Questions

1. **DAV:invert implementation strategy**: Should the server declare `DAV:no-invert`
   in `DAV:acl-restrictions` to avoid this complexity, or implement a full
   application-side negation evaluator?

2. **Resource wildcards for collection ACLs**: Should collection ACLs use
   `keyMatch2` patterns like `/papers/{*}` to cover all members, or should each
   member resource get its own explicit policy rows populated at creation time?
   The latter is more precise but writes more rows; the former requires the pattern
   syntax to correctly scope inheritance.

3. **Priority renumbering**: What gap size to use for ACE priorities, and what is
   the strategy when a gap is exhausted (batch renumber vs. fractional priority)?

4. **`DAV:property` principal staleness**: When `DAV:owner` changes via `PROPPATCH`,
   the stored Casbin policy rows for that resource's owner-based ACEs become stale.
   Should owner ACEs be stored as a synthetic principal tied to the resource
   (e.g., `resource:<id>:owner`) and resolved at query time via application code
   rather than stored as a concrete principal in the policy table?
