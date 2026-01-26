# 12. Authorization & Access Control

## 12.1 WebDAV ACL (RFC 3744)

Shuriken uses Casbin for authorization with a ReBAC model.

**Privilege Hierarchy**:
```
DAV:all
├── DAV:read
│   ├── DAV:read-acl
│   └── DAV:read-current-user-privilege-set
├── DAV:write
│   ├── DAV:write-acl
│   ├── DAV:write-properties
│   ├── DAV:write-content
│   ├── DAV:bind (add child)
│   └── DAV:unbind (remove child)
└── DAV:unlock
```

## 12.2 CalDAV Privileges

- `CALDAV:read-free-busy`: Can query free-busy (even without full read)

## 12.3 Shuriken ACL Model

**Principal Types** (from `principal.principal_type`):
- `user`: Individual user
- `group`: User group
- `public`: Anonymous/public access
- `resource`: Room or resource

### 12.3.1 Permission Levels

Shuriken uses a small set of **permission levels** that apply to either:
- a **collection** (calendar/addressbook), or
- an **individual item** (calendar object resource / vCard resource).

Permissions are **additive** across scopes: a user’s effective permission for an item is never lower than their effective permission on its parent collection.

**Levels** (lowest → highest):
- `read-freebusy`
- `read`
- `read-share` (can share at `read`)
- `edit`
- `edit-share` (can share at `read` or `edit`)
- `admin` (can share at `read`, `read-share`, `edit`, `edit-share`)
- `owner` (all permissions)

**Operational meaning**:
- `read-freebusy`: Can execute free-busy queries for the calendar user/collection (`CALDAV:free-busy-query`) but cannot read event bodies.
- `read`: Can read items and metadata (e.g., `PROPFIND`, `REPORT` queries, `GET` on items).
- `edit`: Can create/update/delete items (e.g., `PUT`, `DELETE`, `MOVE` for rename where supported) subject to collection constraints.
- `*-share` / `admin` / `owner`: Can grant access to others within the allowed share ceiling described above.

Sharing is modeled as the ability to create/update ACL/share policy entries for a target principal.

**Enforcement Flow**:
1. Extract user principal from authentication
2. Expand to `{user} ∪ groups(user) ∪ {public}`
3. Check Casbin policy for action on resource
4. Allow or deny

### 12.3.2 Collection vs Item Permission Resolution (Additive)

To enforce “cannot have lower access to a member than the collection”, compute an **effective permission** for each request:

- Let `p_collection` be the user’s effective permission on the parent collection (calendar/addressbook).
- Let `p_item` be the user’s direct/effective permission on the item (if the request targets a specific item).
- Define `p_effective = max(p_collection, p_item)` in the total ordering shown above.

Use `p_effective` for all authorization checks on that item.

Practical implications:
- If a user has `edit` on a calendar, a per-event entry of `read` does not reduce what they can do; they still have `edit`.
- If you expose ACLs, avoid emitting contradictory lower per-item entries that confuse clients; prefer representing the effective result.
- Keep individual permission grants recorded to maintain fidelity if a user loses access to a parent collection. For example a user with
  read access to foo/bar who is later granted write access to foo, should not lose read access to foo/bar if their access to foo is later removed

### 12.3.3 Suggested Mapping to WebDAV/CalDAV/CardDAV Operations

This is a pragmatic mapping used for enforcement and for deriving `DAV:current-user-privilege-set`:

- `read-freebusy`: allow `REPORT` free-busy only (`CALDAV:free-busy-query`), and minimal property discovery needed for clients to locate free-busy targets.
- `read`: allow read operations (`PROPFIND`, `REPORT` queries, `GET` on items).
- `edit` (and above): allow write-content operations (`PUT`, `DELETE`, and rename via `MOVE` where supported) and writable `PROPPATCH` on supported properties.
- Share-capable levels: allow the specific “share/ACL mutation” endpoints your app exposes; do not equate this to unconstrained `DAV:write-acl` unless you actually implement generic WebDAV ACL mutation.

### 12.3.4 Permission Matrix (Practical)

Use this as the implementation checklist. Apply it to `p_effective` (after the additive resolution rule above).

**Collection-targeted operations** (calendar/addressbook collection):

| Level | Read discovery (`OPTIONS`, `PROPFIND`) | Query (`REPORT`) | Sync (`sync-collection`) | Create child items | Rename/move items | Delete items | Modify collection properties | Share to others |
|------:|----------------------------------------|------------------|--------------------------|-------------------|------------------|-------------|-----------------------------|----------------|
| `read-freebusy` | limited (only what’s needed for discovery) | **CalDAV only**: `free-busy-query` | optional (if you allow) | ✗ | ✗ | ✗ | ✗ | ✗ |
| `read` | ✓ | CalDAV: `calendar-query`, `calendar-multiget`, `free-busy-query` (if applicable); CardDAV: `addressbook-query`, `addressbook-multiget` | ✓ (read-only) | ✗ | ✗ | ✗ | ✗ | ✗ |
| `read-share` | ✓ | same as `read` | ✓ | ✗ | ✗ | ✗ | ✗ | grant up to `read` |
| `edit` | ✓ | same as `read` | ✓ | ✓ (PUT to create) | ✓ (MOVE where supported) | ✓ (DELETE) | limited (e.g., displayname/description) | ✗ |
| `edit-share` | ✓ | same as `read` | ✓ | ✓ | ✓ | ✓ | limited | grant up to `read` or `edit` |
| `admin` | ✓ | same as `read` | ✓ | ✓ | ✓ | ✓ | ✓ (within product policy) | grant up to `read`, `read-share`, `edit`, `edit-share` |
| `owner` | ✓ | same as `read` | ✓ | ✓ | ✓ | ✓ | ✓ | grant any (including `admin`); treat `owner` as the resource owner |

Notes:
- “Modify collection properties” should typically be restricted to a safe subset (`DAV:displayname`, description properties). If you support more, gate them at `admin`/`owner`.
- “Create child items” means creating/updating individual resources within the collection (CalDAV: calendar object resources; CardDAV: vCard resources). It does not imply creating new collections.

**Item-targeted operations** (event/vCard resource):

| Level | Read item (`GET`) | Read metadata (`PROPFIND` item) | Update (`PUT`) | Delete (`DELETE`) | Read freebusy |
|------:|-------------------|-------------------------------|----------------|------------------|--------------|
| `read-freebusy` | ✗ | limited | ✗ | ✗ | ✓ (via collection free-busy mechanisms) |
| `read` | ✓ | ✓ | ✗ | ✗ | ✓ (if applicable) |
| `read-share` | ✓ | ✓ | ✗ | ✗ | ✓ |
| `edit` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `edit-share` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `owner` | ✓ | ✓ | ✓ | ✓ | ✓ |

**Share operations**:
- Sharing is product-defined (not a standardized WebDAV method in most client stacks). Implement it via app-specific endpoints and/or internal policy management.
- A share action should be authorized against the **collection** (or item, if you support per-item shares), and MUST respect the level’s “share ceiling” from the table above.

### 12.3.5 Casbin Policy Shape (Recommended)

The bundled Casbin model (`src/component/auth/casbin_model.conf`) is designed so:
- **Additivity is automatic**: a grant on a collection applies to its members via containment (`g4`).
- **Higher levels imply lower levels**: modeled via a role hierarchy (`g5`) so you don’t have to duplicate policies.
- **Sharing ceilings are enforceable**: modeled as explicit “grant actions” (e.g., `share_grant:edit-share`).

**Casbin request**:
- `sub`: principal (`user:...`, `group:...`, `public`)
- `obj`: resource instance (`cal:...`, `evt:...`, `ab:...`, `card:...`)
- `act`: action string (see below)

**Policy rows** (conceptual; stored in `casbin_rule`):

- `p, <min_role>, <obj_type>, <act>`
    - Example: `p, read, calendar, read`
    - Example: `p, edit, calendar, write`
    - Example: `p, read-freebusy, calendar, read_freebusy`

- `g, <principal>, <resource>, <granted_role>`
    - Example: `g, user:alice, cal:team, edit-share`
    - Example: `g, group:eng, cal:team, read`

- `g2, <resource>, <obj_type>` (typing)
    - Example: `g2, cal:team, calendar`
    - Example: `g2, evt:team:123, calendar_event`

- `g4, <child>, <parent>` (containment)
    - Example: `g4, evt:team:123, cal:team`
    - Example: `g4, card:alice:456, ab:alice`

- `g5, <higher_role>, <lower_role>` (role implication)
    - Seed these once:
        - `g5, owner, admin`
        - `g5, admin, edit-share`
        - `g5, edit-share, edit`
        - `g5, edit, read-share`
        - `g5, read-share, read`
        - `g5, read, read-freebusy`

**Action vocabulary (minimal)**:
- `read_freebusy`: free-busy disclosure without event details (CalDAV)
- `read`: read items + metadata (PROPFIND/REPORT/GET)
- `write`: create/update/delete items (PUT/DELETE/MOVE rename)
- `share_grant:<level>`: grant a target principal up to `<level>`
    - Examples: `share_grant:read`, `share_grant:edit`, `share_grant:edit-share`

**Share ceiling via policy**:
- Allowing `share_grant:read` at `read-share`:
    - `p, read-share, calendar, share_grant:read`
- Allowing `share_grant:read` and `share_grant:edit` at `edit-share`:
    - `p, edit-share, calendar, share_grant:read`
    - `p, edit-share, calendar, share_grant:edit`
- Allowing `share_grant:read`, `read-share`, `edit`, `edit-share` at `admin`:
    - `p, admin, calendar, share_grant:read`
    - `p, admin, calendar, share_grant:read-share`
    - `p, admin, calendar, share_grant:edit`
    - `p, admin, calendar, share_grant:edit-share`

Repeat the `p, ...` entries for `addressbook` / `vcard` as needed.

### 12.3.6 Seed Rules (SQL)

The Diesel Casbin adapter stores rules in the `casbin_rule` table.

- `ptype` is one of `p`, `g`, `g2`, `g3`, `g4`, `g5`.
- This schema uses `v0..v5` as required columns; when you only need `v0..v2`, store empty strings in the rest.

**Seed the permission hierarchy (`g5`) once**:

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    ('g5', 'owner',      'admin',      '', '', '', ''),
    ('g5', 'admin',      'edit-share', '', '', '', ''),
    ('g5', 'edit-share', 'edit',       '', '', '', ''),
    ('g5', 'edit',       'read-share', '', '', '', ''),
    ('g5', 'read-share', 'read',       '', '', '', ''),
    ('g5', 'read',       'read-freebusy', '', '', '', '');
```

**Baseline capability policies (`p`)**

These define what each *minimum role* allows on each *object type*.

Calendar types:

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    -- Calendar collections
    ('p', 'read-freebusy', 'calendar',       'read_freebusy', '', '', ''),
    ('p', 'read',          'calendar',       'read',          '', '', ''),
    ('p', 'edit',          'calendar',       'write',         '', '', ''),

    -- Calendar items (events)
    ('p', 'read',          'calendar_event', 'read',          '', '', ''),
    ('p', 'edit',          'calendar_event', 'write',         '', '', '');
```

Address book types:

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    -- Addressbook collections
    ('p', 'read',          'addressbook', 'read',  '', '', ''),
    ('p', 'edit',          'addressbook', 'write', '', '', ''),

    -- vCard items
    ('p', 'read',          'vcard',       'read',  '', '', ''),
    ('p', 'edit',          'vcard',       'write', '', '', '');
```

**Share ceilings (`share_grant:<level>`)**

These policies enforce what a share-capable user is allowed to grant to someone else.

Calendars:

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    ('p', 'read-share', 'calendar', 'share_grant:read',       '', '', ''),
    ('p', 'edit-share', 'calendar', 'share_grant:read',       '', '', ''),
    ('p', 'edit-share', 'calendar', 'share_grant:edit',       '', '', ''),
    ('p', 'admin',      'calendar', 'share_grant:read',       '', '', ''),
    ('p', 'admin',      'calendar', 'share_grant:read-share', '', '', ''),
    ('p', 'admin',      'calendar', 'share_grant:edit',       '', '', ''),
    ('p', 'admin',      'calendar', 'share_grant:edit-share', '', '', ''),
    ('p', 'owner',      'calendar', 'share_grant:admin',      '', '', '');
```

Addressbooks (mirror the same ceiling behavior):

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    ('p', 'read-share', 'addressbook', 'share_grant:read',       '', '', ''),
    ('p', 'edit-share', 'addressbook', 'share_grant:read',       '', '', ''),
    ('p', 'edit-share', 'addressbook', 'share_grant:edit',       '', '', ''),
    ('p', 'admin',      'addressbook', 'share_grant:read',       '', '', ''),
    ('p', 'admin',      'addressbook', 'share_grant:read-share', '', '', ''),
    ('p', 'admin',      'addressbook', 'share_grant:edit',       '', '', ''),
    ('p', 'admin',      'addressbook', 'share_grant:edit-share', '', '', ''),
    ('p', 'owner',      'addressbook', 'share_grant:admin',      '', '', '');
```

You still need to populate:
- `g2` edges to type each resource instance,
- `g4` edges for item → collection containment,
- `g` edges for actual grants (who has what role on which resource),
- and `g3` edges for user → group membership (if you use groups).

## 12.4 ACL Discovery Properties

Many clients PROPFIND these properties to decide which actions are permitted and to discover principals.

- `DAV:current-user-privilege-set`
- `DAV:supported-privilege-set` (clients use this to understand the privilege model)
- `DAV:acl` (if you expose ACLs)
- `DAV:acl-restrictions`
- `DAV:inherited-acl-set`
- `DAV:principal-collection-set`
- `DAV:principal-URL`
- `DAV:current-user-principal` (often requested alongside ACL properties)

At minimum, return consistent values for `DAV:current-user-privilege-set` and enforce the same privileges across all methods.

For properties you do not support, return a `207 Multi-Status` with a `404 Not Found` `propstat` for those properties rather than failing the entire PROPFIND.

---
