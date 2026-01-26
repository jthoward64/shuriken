# Phase 8: Authorization Integration

**Status**: ⚠️ **PARTIAL (~25%)**  
**Last Updated**: 2026-01-25 (Corrected Assessment)

---

## Overview

Phase 8 integrates Casbin-based authorization throughout the system and exposes ACL discovery properties to clients. While authorization infrastructure exists (Casbin enforcer, model, policies), handlers do NOT actually call the authorization functions, meaning any authenticated user can access any resource.

**Critical Gap**: `authorize::require()` exists but is NOT CALLED in handlers. Authorization is not enforced.

---

## Implementation Status

### ✅ Implemented Features

#### Casbin Infrastructure (`src/component/auth/`)

- [x] **Casbin enforcer initialization** — ReBAC model loading
  - Loads model from `casbin_model.conf`
  - Loads policies from `casbin_rule` table
  
- [x] **ReBAC model** (`casbin_model.conf`) — Role-based access control
  - **Roles**: `freebusy`, `reader`, `writer`, `owner`
  - **Type-based permissions**: Separate permissions per resource type
  - **Flat group model**: No nested groups

- [x] **Subject expansion logic** — User → {user, groups, public}
  - Code exists in `src/component/auth/subject.rs`

- [x] **Authorization function** — `authorize::require()`
  - Function exists in `src/component/auth/authorize.rs`
  - Takes depot, object_id, action
  - Returns 403 Forbidden on authorization failure

#### Middleware (`src/component/middleware/auth.rs`)

- [x] **Authentication middleware** — Identity extraction
  - `DepotUser::User(uuid)`: Authenticated user
  - `DepotUser::Public`: Unauthenticated user
  - Basic Auth parsing

---

### ❌ NOT Implemented — CRITICAL

#### Authorization in Handlers — **NOT WIRED**

**Evidence**: Searched all handlers for `authorize::require` calls. None found.

**Impact**: ANY authenticated user can:
- Read any calendar/addressbook (privacy breach)
- Modify any resource (data integrity violation)
- Delete any resource (data loss risk)

**What's Missing**:
- [ ] PROPFIND — Must check read permission before serving properties
- [ ] PROPPATCH — Must check write permission before modifying properties
- [ ] GET/HEAD — Must check read permission before serving content
- [ ] PUT — Must check write permission before creating/updating resources
- [ ] DELETE — Must check write permission before deleting resources
- [ ] COPY — Must check write permission on destination collection
- [ ] MOVE — Must check write permission on source and destination
- [ ] Reports — Must check read permission on collection

**Fix Required**: Each handler must:
```rust
use crate::component::auth::authorize;

// In handler, before any DB operations:
let user = depot.get::<DepotUser>("user")?;
authorize::require(user, resource_id, Action::Read).await?;
```

---

### ❌ Not Implemented

#### ACL Discovery Properties (RFC 3744)

**Current State**: Clients cannot discover what permissions they have.

##### `DAV:current-user-privilege-set` (RFC 3744 §5.4)

**Purpose**: Describes what the current user can do with a resource.

**Example**:
```xml
<D:current-user-privilege-set xmlns:D="DAV:">
  <D:privilege><D:read/></D:privilege>
  <D:privilege><D:write/></D:privilege>
</D:current-user-privilege-set>
```

**Impact**: Clients show incorrect UI (e.g., "Delete" button when user can't delete).

**Recommended Implementation**:
1. Add to PROPFIND live properties
2. Query Casbin for all privileges: `read`, `write`, `admin`, `read-free-busy`
3. Return only granted privileges

**Estimated Effort**: 2-3 days

##### `DAV:acl` (RFC 3744 §5.5)

**Purpose**: Lists all ACEs (Access Control Entries) for a resource.

**Example**:
```xml
<D:acl xmlns:D="DAV:">
  <D:ace>
    <D:principal>
      <D:href>/principals/users/alice/</D:href>
    </D:principal>
    <D:grant>
      <D:privilege><D:read/></D:privilege>
      <D:privilege><D:write/></D:privilege>
    </D:grant>
  </D:ace>
  <D:ace>
    <D:principal>
      <D:href>/principals/groups/team/</D:href>
    </D:principal>
    <D:grant>
      <D:privilege><D:read/></D:privilege>
    </D:grant>
  </D:ace>
</D:acl>
```

**Impact**: Users cannot see who has access to their resources.

**Note**: May be restricted to owner/admin only for privacy.

**Recommended Implementation**:
1. Add to PROPFIND live properties
2. Query Casbin for all policies matching resource
3. Build ACE list with principal hrefs and privileges

**Estimated Effort**: 3-5 days

##### `DAV:principal-collection-set` (RFC 3744 §5.8)

**Purpose**: Lists principal collections for discovery.

**Example**:
```xml
<D:principal-collection-set xmlns:D="DAV:">
  <D:href>/principals/users/</D:href>
  <D:href>/principals/groups/</D:href>
</D:principal-collection-set>
```

**Impact**: Clients cannot discover available principals for sharing.

**Recommended Implementation**:
1. Add to PROPFIND live properties
2. Return static list of principal collection URLs

**Estimated Effort**: 1 day

##### `DAV:current-user-principal` (RFC 5397)

**Purpose**: Returns URL of authenticated principal.

**Example**:
```xml
<D:current-user-principal xmlns:D="DAV:">
  <D:href>/principals/users/alice/</D:href>
</D:current-user-principal>
```

**Impact**: Clients cannot discover their own principal URL for discovery flow.

**Recommended Implementation**:
1. Add to PROPFIND live properties
2. Lookup principal URL from `DepotUser`
3. Return href to principal resource

**Estimated Effort**: 1 day

##### `DAV:owner` (RFC 3744 §5.1)

**Purpose**: Returns owner principal URL.

**Example**:
```xml
<D:owner xmlns:D="DAV:">
  <D:href>/principals/users/alice/</D:href>
</D:owner>
```

**Impact**: Clients cannot determine who owns a resource.

**Recommended Implementation**:
1. Add to PROPFIND live properties
2. Query collection/instance owner from database
3. Return href to owner's principal

**Estimated Effort**: 1 day

##### `DAV:group-membership` (RFC 3744 §4.4)

**Purpose**: Lists groups the principal belongs to.

**Example**:
```xml
<D:group-membership xmlns:D="DAV:">
  <D:href>/principals/groups/team/</D:href>
  <D:href>/principals/groups/admins/</D:href>
</D:group-membership>
```

**Impact**: Clients cannot display group membership for principals.

**Recommended Implementation**:
1. Add to PROPFIND live properties (only for principal resources)
2. Query `membership` table for user's groups
3. Return hrefs to group principals

**Estimated Effort**: 2-3 days

---

#### 2. Privilege Hierarchy (RFC 3744 §3.1)

**Current State**: Basic privileges exist (`read`, `write`, `admin`) but no explicit hierarchy.

**What's Missing**:

##### `read-free-busy` Privilege

**Purpose**: Lower than `read`, allows free-busy queries without event details.

**Use Case**: Allow coworkers to see your availability without seeing meeting details.

**Recommended Implementation**:
1. Add `read-free-busy` to Casbin model
2. Grant by default to all authenticated users
3. Check in free-busy-query handler (Phase 7)

**Estimated Effort**: 1 day

##### Aggregated Privileges

**Purpose**: Convenience privileges that imply multiple sub-privileges.

**Examples**:
- `all`: Implies all privileges (read, write, admin, read-free-busy)
- `read-write`: Implies read and write

**Recommended Implementation**:
1. Add aggregate privileges to Casbin model
2. Expand aggregates when checking permissions

**Estimated Effort**: 2-3 days

---

#### 3. Shared Calendar/Addressbook Support

**Current State**: No HTTP endpoint to create shares or manage permissions.

**What's Missing**:

##### Share Creation API

**Purpose**: Allow users to share calendars/addressbooks with specific privileges.

**Proposed Endpoint**: POST to `/_api/shares`
```json
{
  "resource_id": "calendar-uuid",
  "principal_id": "user-uuid or group-uuid",
  "role": "reader"  // or "writer", "owner"
}
```

**Response**: 201 Created with share details

**Recommended Implementation**:
1. Create `POST /_api/shares` endpoint
2. Validate principal exists
3. Insert Casbin policy: `g, principal, role, resource`
4. Return share details

**Estimated Effort**: 3-5 days

##### Share Ceiling Enforcement

**Purpose**: Prevent privilege escalation (reader cannot grant writer).

**Rules**:
- Reader cannot grant any privileges
- Writer cannot grant owner
- Owner can grant any privileges

**Recommended Implementation**:
1. Check current user's role on resource
2. Reject if attempting to grant higher role
3. Return 403 Forbidden with explanation

**Estimated Effort**: 2-3 days

##### Share Revocation

**Purpose**: Remove access for a principal.

**Proposed Endpoint**: DELETE `/api/shares/{share_id}`

**Recommended Implementation**:
1. Create `DELETE /_api/shares/{share_id}` endpoint
2. Verify current user has `admin` privilege
3. Delete Casbin policy
4. Return 204 No Content

**Estimated Effort**: 2-3 days

##### Share Listing

**Purpose**: List all shares for a resource.

**Proposed Endpoint**: GET `/api/shares?resource_id=calendar-uuid`

**Response**:
```json
{
  "shares": [
    {
      "id": "share-uuid",
      "resource_id": "calendar-uuid",
      "principal_id": "user-uuid",
      "principal_name": "Bob",
      "role": "reader"
    }
  ]
}
```

**Estimated Effort**: 2-3 days

---

## RFC Compliance

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 3744 §3.1: Privileges | ⚠️ Partial | Enforced but not discoverable |
| RFC 3744 §5: ACL properties | ❌ Missing | Clients can't discover permissions |
| RFC 3744 §5.4: current-user-privilege-set | ❌ Missing | No permission introspection |
| RFC 3744 §5.5: acl | ❌ Missing | Can't see who has access |
| RFC 3744 §9: Principal properties | ❌ Missing | No principal discovery |
| RFC 5397: current-user-principal | ❌ Missing | No principal discovery |
| RFC 4791 §9.3: read-free-busy | ❌ Missing | No freebusy-specific privilege |
| CalDAV: Sharing | ❌ Missing | No shared calendars |
| CardDAV: Sharing | ❌ Missing | No shared addressbooks |

**Compliance Score**: 1/9 features (11%)

---

## Next Steps

### Immediate Priorities

1. **Implement ACL discovery properties** — HIGH PRIORITY
   - Add `current-user-privilege-set` to PROPFIND
   - Add `current-user-principal` to PROPFIND
   - Add `owner` to PROPFIND
   - Estimated effort: 1 week

2. **Implement share creation API** — MEDIUM PRIORITY
   - Create `POST /_api/shares` endpoint
   - Add share ceiling enforcement
   - Estimated effort: 3-5 days

3. **Add `read-free-busy` privilege** — LOW PRIORITY
   - Update Casbin model
   - Grant to authenticated users by default
   - Estimated effort: 1 day

### Nice-to-Have

4. **Implement full ACL property** — LOW PRIORITY
   - List all ACEs for resource
   - Restrict to owner/admin
   - Estimated effort: 3-5 days

5. **Add share listing API** — LOW PRIORITY
   - GET `/api/shares?resource_id=...`
   - Estimated effort: 2-3 days

---

## Dependencies

**Blocks**: None — Authorization works, discovery is a UX enhancement.

**Depends On**: None — Casbin integration is complete.

---

## Next Phase: Phase 9

**Focus**: Discovery & Polish (Well-known URIs, principal discovery, client compatibility)

**Status**: ❌ **NOT STARTED (0%)**
