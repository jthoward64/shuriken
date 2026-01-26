# Phase 0: Database Schema and Architecture

**Status**: ✅ **COMPLETE (100%)**  
**Last Updated**: 2026-01-25 (Corrected Assessment)

---

## Overview

Phase 0 establishes the foundational database schema for Shuriken's CalDAV/CardDAV server. The schema supports:
- Multi-tenant identity and access control
- Entity/instance separation for content sharing
- Efficient CalDAV/CardDAV query operations
- WebDAV synchronization primitives
- Soft-delete and audit trail capabilities

---

## Implementation Status

### ✅ All Tables Implemented

#### Core Identity Tables
- [x] **`user`** — User accounts with email, name, principal_id
- [x] **`auth_user`** — External authentication provider mappings (OAuth, LDAP)
- [x] **`group`** — Organizational groups for collaborative sharing
- [x] **`group_name`** — Group names and aliases (supports multiple names per group)
- [x] **`membership`** — Many-to-many user-group relationships
- [x] **`principal`** — Unified principal namespace (users, groups, system/public/resource principals)
- [x] **`casbin_rule`** — Authorization rules for Casbin ReBAC model

#### DAV Storage Tables
- [x] **`dav_collection`** — Collections (calendars/addressbooks) with sync tokens
- [x] **`dav_entity`** — Canonical content entities (shareable across collections)
- [x] **`dav_instance`** — Per-collection resource instances with ETags
- [x] **`dav_component`** — Component tree for iCalendar/vCard content
- [x] **`dav_property`** — Properties with typed value columns
- [x] **`dav_parameter`** — Parameters associated with properties
- [x] **`dav_tombstone`** — Deletion tombstones for sync correctness
- [x] **`dav_shadow`** — Debug/compat payload storage (raw bytes)

#### Derived Index Tables
- [x] **`cal_index`** — CalDAV query index (uid, dtstart_utc, dtend_utc, rrule_text, etc.)
- [x] **`cal_occurrence`** — Expanded recurrence occurrences (entity_id, start_utc, end_utc)
- [x] **`cal_timezone`** — VTIMEZONE cache (unused currently)
- [x] **`cal_attendee`** — Attendee index for scheduling queries
- [x] **`card_index`** — CardDAV query index (uid, fn, n_family, n_given, etc.)
- [x] **`card_email`** — Indexed vCard email addresses
- [x] **`card_phone`** — Indexed vCard phone numbers

#### Schema Features
- [x] **UUID v7 primary keys** — Native PostgreSQL 17 `uuidv7()` function
- [x] **Soft deletes** — `deleted_at` columns for undo windows
- [x] **Auto-updated timestamps** — `updated_at` via `diesel_manage_updated_at()`
- [x] **Foreign key constraints** — Referential integrity enforcement
- [x] **Check constraints** — Collection type validation

---

## ⚠️ Schema Usage Issues (Not Schema Bugs)

### 1. `dav_shadow` Currently Unused (Component Tree Is Active)

**Observation**: GET/HEAD responses reconstruct from `dav_component`/`dav_property`/`dav_parameter` via `get_entity_with_tree()` and serializers; `dav_shadow` is not used in request handling.

**Impact**: The component tree is the canonical source of truth for output serialization; `dav_shadow` is currently unused storage.

### 2. `cal_timezone` Table Unused

**Observation**: Table exists but timezone resolution uses only `chrono-tz` IANA lookup.

**Impact**: Custom VTIMEZONE components aren't cached or used.

### 3. `card_index.search_tsv` Not Populated

**Observation**: Full-text search column exists but isn't populated on insert.

**Impact**: Can't do efficient text search across contacts.

---

## Database Improvement Recommendations

### 🔴 High Priority

#### 1. Add Composite Indexes for Time-Range Queries
```sql
CREATE INDEX idx_cal_occurrence_entity_time 
  ON cal_occurrence (entity_id, start_utc, end_utc) 
  WHERE deleted_at IS NULL;

CREATE INDEX idx_cal_index_entity_time
  ON cal_index (entity_id, dtstart_utc, dtend_utc)
  WHERE deleted_at IS NULL;
```

#### 2. Add `collection_id` to Index Tables
```sql
-- Denormalize for faster queries without joins
ALTER TABLE cal_index ADD COLUMN collection_id UUID REFERENCES dav_collection(id);
ALTER TABLE cal_occurrence ADD COLUMN collection_id UUID REFERENCES dav_collection(id);
ALTER TABLE card_index ADD COLUMN collection_id UUID REFERENCES dav_collection(id);
```

### 🟡 Medium Priority

#### 3. Simplify Entity/Instance If Sharing Unused
If content sharing across collections isn't needed, merge entity fields into instance.

#### 4. Consider JSONB for Properties
Current 5 typed columns are complex. JSONB would be more flexible.

### 🟢 Low Priority

#### 5. Partition `cal_occurrence` for Scale
Range partition by `start_utc` for large deployments.

#### 6. Add GIN Index for Contact Search
```sql
CREATE INDEX idx_card_index_search ON card_index USING GIN (search_tsv);
```

---

## Architecture Decision: Component Tree vs Raw Storage

The current implementation uses the **component tree** as the canonical source of truth.

**Recommendation**:
- **Option A (current)**: Keep component tree as canonical and remove/repurpose `dav_shadow`.
- **Option B**: If you decide to simplify, remove tree tables and keep only raw storage + indexes.

---

## RFC Compliance

- ✅ **RFC 4791 §4.1** — Entity/instance separation supports one UID per collection
- ✅ **RFC 6578** — Tombstones and sync revision tracking ready
- ✅ **RFC 3744** — Principal-based ACL model supports WebDAV ACL
- ✅ **RFC 5545** — Component tree can represent full iCalendar structure
