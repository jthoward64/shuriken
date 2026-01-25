# Phase 0: Database Schema and Architecture

**Status**: ✅ **COMPLETE (100%)**  
**Last Updated**: 2026-01-25

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

### ✅ Completed Features

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
  - Supports calendar and addressbook resource types
  - Tracks sync token for WebDAV sync protocol
  - Owner principal reference
- [x] **`dav_entity`** — Canonical content entities (shareable across collections)
  - Stores the actual iCalendar/vCard data
  - Single source of truth for content
  - Enables content sharing without duplication
- [x] **`dav_instance`** — Per-collection resource instances with ETags
  - Links entities to collections
  - Tracks ETags for conditional requests
  - Maintains sync revision for change detection
- [x] **`dav_component`** — Component tree for iCalendar/vCard content
  - Hierarchical structure (VCALENDAR → VEVENT, VCARD, etc.)
  - Preserves component relationships
- [x] **`dav_property`** — Properties with typed value columns
  - Text, integer, float, datetime, boolean values
  - Separate columns for deterministic serialization
- [x] **`dav_parameter`** — Parameters associated with properties
  - Supports RFC 6868 parameter encoding
- [x] **`dav_tombstone`** — Deletion tombstones for sync correctness
  - Tracks deleted instances for sync protocol
  - Enables clients to detect deletions
- [x] **`dav_shadow`** — Debug/compat payload storage
  - Stores original inbound/outbound payloads
  - Useful for debugging and compatibility testing

#### Derived Index Tables
- [x] **`cal_index`** — CalDAV query index
  - uid, component_type, dtstart_utc, dtend_utc
  - all_day, recurrence_id_utc, rrule_text
  - organizer, summary, timezone_tzid
  - Optimizes calendar-query performance
- [x] **`card_index`** — CardDAV query index
  - uid, fn (formatted name), version, kind
  - Supports full-text search
- [x] **`card_email`** — Indexed vCard email addresses
  - Enables email-based contact queries
- [x] **`card_phone`** — Indexed vCard phone numbers
  - Enables phone-based contact queries

#### Schema Features
- [x] **UUID v7 primary keys** — Time-ordered, globally unique identifiers
  - Native PostgreSQL 17 `uuidv7()` function
  - Creation timestamp extractable via `uuid_extract_timestamp(id)`
- [x] **Soft deletes** — `deleted_at` columns for undo windows
  - Supports pending purge workflows
  - Enables data recovery
- [x] **Auto-updated timestamps** — `updated_at` via `diesel_manage_updated_at()`
  - Automatic tracking of modification times
- [x] **Foreign key constraints** — Referential integrity enforcement
- [x] **Check constraints** — Collection type validation and business rules

---

## ❌ Missing Elements

### **CRITICAL**: `cal_occurrence` Table

**Status**: Not created  
**Impact**: Recurring event queries must expand RRULE on every request (expensive and doesn't scale)  
**Blocks**: Phase 5 (Recurrence & Time Zones)

**Required Structure**:
```sql
CREATE TABLE cal_occurrence (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    instance_id UUID NOT NULL REFERENCES dav_instance(id),
    dtstart_utc TIMESTAMPTZ NOT NULL,
    dtend_utc TIMESTAMPTZ NOT NULL,
    sequence INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cal_occurrence_timerange ON cal_occurrence (dtstart_utc, dtend_utc) WHERE deleted_at IS NULL;
CREATE INDEX idx_cal_occurrence_instance ON cal_occurrence (instance_id) WHERE deleted_at IS NULL;
```

**Purpose**: Cache expanded event occurrences for efficient time-range queries on recurring events

---

## RFC Compliance

- ✅ **RFC 4791 §4.1** — Entity/instance separation supports one UID per resource
- ✅ **RFC 6578** — Tombstones and sync revision tracking ready for WebDAV sync
- ✅ **RFC 3744** — Principal-based ACL model supports WebDAV ACL

---

## Architecture Decisions

### Entity/Instance Separation

The schema separates **content** (entities) from **instances** (collection memberships):

- **Entity** = Canonical iCalendar/vCard content (single source of truth)
- **Instance** = Membership in a collection (can have multiple per entity)

This design enables:
1. Content sharing without duplication
2. Per-collection ETags and sync revisions
3. Efficient storage for shared resources

### Derived Indexes

Rather than querying the normalized component/property tree for every search, we maintain denormalized indexes:

- `cal_index` — Flattened calendar event metadata
- `card_index` — Flattened contact metadata
- `card_email`, `card_phone` — Searchable contact fields

These indexes are populated on PUT and cleaned on DELETE.

### Soft Deletes

Soft deletes (`deleted_at` columns) provide:
- Undo windows for user mistakes
- Pending purge workflows
- Tombstone tracking for sync protocol

---

## Next Phase: Phase 1

Phase 1 focuses on parsing and serializing iCalendar, vCard, and WebDAV XML formats to work with this database schema.

**Status**: ✅ Complete (98%)
