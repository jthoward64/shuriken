# SQL Schema Recommendations

**Created**: 2026-01-25  
**Purpose**: Document recommended schema changes to better support application requirements.

---

## Executive Summary

The current schema is well-designed with good separation of concerns (entity/instance model, component tree, derived indexes). However, several enhancements would improve performance, simplify queries, and better support RFC compliance.

**Priority Legend**:
- 🔴 **CRITICAL** — Blocks core functionality
- 🟠 **HIGH** — Significant improvement
- 🟡 **MEDIUM** — Nice to have
- 🟢 **LOW** — Future consideration

---

## 🔴 CRITICAL: Missing Indexes for Sync Queries

### Problem

The sync-collection report (RFC 6578) needs to efficiently query:
1. All instances in a collection with `sync_revision > baseline`
2. All tombstones in a collection with `sync_revision > baseline`

The current index on `dav_tombstone` doesn't cover this query pattern efficiently.

### Recommended Migration

```sql
-- Optimize tombstone queries for sync-collection
CREATE INDEX idx_dav_tombstone_sync_revision 
ON dav_tombstone(collection_id, sync_revision);

-- Partial index for non-deleted tombstones within retention window
CREATE INDEX idx_dav_tombstone_sync_active
ON dav_tombstone(collection_id, sync_revision, uri);
```

---

## 🔴 CRITICAL: Collection-to-Instance Query Path

### Problem

Many queries need to go from collection → instance → entity → cal_index. This requires multiple JOINs.

### Current Path
```
dav_collection → dav_instance → dav_entity → cal_index
```

### Recommended: Add `collection_id` to Derived Indexes

```sql
-- Add collection_id to cal_index for direct filtering
ALTER TABLE cal_index ADD COLUMN collection_id UUID REFERENCES dav_collection(id);

-- Populate from existing data
UPDATE cal_index ci
SET collection_id = di.collection_id
FROM dav_instance di
WHERE ci.entity_id = di.entity_id;

-- Add NOT NULL constraint after population
ALTER TABLE cal_index ALTER COLUMN collection_id SET NOT NULL;

-- Add efficient composite index
CREATE INDEX idx_cal_index_collection_timerange 
ON cal_index(collection_id, dtstart_utc, dtend_utc) 
WHERE deleted_at IS NULL;

COMMENT ON COLUMN cal_index.collection_id IS 'Denormalized collection reference for efficient calendar-query';
```

**Same pattern for**:
- `cal_occurrence` — add `collection_id`
- `card_index` — add `collection_id`
- `card_email` — add `collection_id`
- `card_phone` — add `collection_id`

**Trade-off**: Denormalization requires updating on MOVE operations, but dramatically simplifies query composition.

---

## 🟠 HIGH: Instance-Level UID Constraint

### Problem

RFC 4791 §5.3.2 requires `no-uid-conflict` — a UID must be unique within a collection. Currently this is enforced in application code.

### Recommended: Database-Level Enforcement

```sql
-- Unique UID per collection (using instance, not entity)
CREATE UNIQUE INDEX uq_dav_instance_collection_uid
ON dav_instance(collection_id, (
  SELECT logical_uid FROM dav_entity WHERE id = dav_instance.entity_id
))
WHERE deleted_at IS NULL;
```

**Alternative** (simpler, denormalized):

```sql
-- Add logical_uid to dav_instance
ALTER TABLE dav_instance ADD COLUMN logical_uid TEXT;

-- Unique constraint
CREATE UNIQUE INDEX uq_dav_instance_collection_uid
ON dav_instance(collection_id, logical_uid)
WHERE deleted_at IS NULL AND logical_uid IS NOT NULL;
```

---

## 🟠 HIGH: ETag Generation Strategy

### Problem

The current `etag` column in `dav_instance` is a TEXT field populated by application code. There's no database-level guarantee of uniqueness or change detection.

### Option A: Database-Generated ETag (Recommended)

```sql
-- Add hash column computed from entity content
ALTER TABLE dav_instance ADD COLUMN content_hash BYTEA;

-- Use content_hash + sync_revision for ETag
-- Application generates: etag = base64(content_hash) + "-" + sync_revision

-- Add trigger to detect when content changes
CREATE OR REPLACE FUNCTION update_instance_on_entity_change()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dav_instance
  SET sync_revision = (
    SELECT COALESCE(MAX(sync_revision), 0) + 1 
    FROM dav_instance 
    WHERE collection_id = dav_instance.collection_id
  ),
  updated_at = NOW()
  WHERE entity_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_entity_updated
AFTER UPDATE ON dav_entity
FOR EACH ROW EXECUTE FUNCTION update_instance_on_entity_change();
```

### Option B: Use Postgres xmin for Optimistic Locking

```sql
-- Use xmin transaction ID as part of ETag
-- This is automatic and doesn't require extra columns
-- etag = format('%s-%s', instance.id, instance.xmin)
```

---

## 🟠 HIGH: Tombstone Retention Policy

### Problem

Tombstones accumulate indefinitely. Clients with very old sync tokens will receive `valid-sync-token` errors, but there's no automatic cleanup.

### Recommended: Retention Window with Purge Job

```sql
-- Add retention policy column
ALTER TABLE dav_collection ADD COLUMN tombstone_retention_days INT DEFAULT 90;

COMMENT ON COLUMN dav_collection.tombstone_retention_days IS 
  'Number of days to retain tombstones for sync (NULL = forever)';

-- Purge function (call from scheduled job)
CREATE OR REPLACE FUNCTION purge_old_tombstones() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM dav_tombstone t
  USING dav_collection c
  WHERE t.collection_id = c.id
    AND c.tombstone_retention_days IS NOT NULL
    AND t.deleted_at < NOW() - (c.tombstone_retention_days || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
```

---

## 🟠 HIGH: VTIMEZONE Storage Optimization

### Problem

The `cal_timezone` table stores full VTIMEZONE text. Many clients send the same VTIMEZONE definitions repeatedly.

### Recommended: Content-Addressable Storage

```sql
-- Change cal_timezone to use content hash as primary key
ALTER TABLE cal_timezone DROP CONSTRAINT cal_timezone_pkey;
ALTER TABLE cal_timezone ADD COLUMN content_hash BYTEA NOT NULL;

-- Hash is SHA256 of normalized VTIMEZONE content
ALTER TABLE cal_timezone ADD PRIMARY KEY (content_hash);

-- TZID becomes non-unique (same TZID can have different definitions over time)
DROP INDEX IF EXISTS cal_timezone_tzid_key;
CREATE INDEX idx_cal_timezone_tzid ON cal_timezone(tzid);

-- Reference from events by hash, not by TZID string
ALTER TABLE cal_index ADD COLUMN timezone_hash BYTEA REFERENCES cal_timezone(content_hash);
```

---

## 🟡 MEDIUM: Component Tree Query Optimization

### Problem

Reconstructing iCalendar/vCard from the component tree requires recursive CTEs:
```sql
WITH RECURSIVE tree AS (
  SELECT * FROM dav_component WHERE entity_id = ? AND parent_component_id IS NULL
  UNION ALL
  SELECT c.* FROM dav_component c JOIN tree t ON c.parent_component_id = t.id
)
SELECT * FROM tree;
```

This is expensive for large objects.

### Recommended: Materialized Path Pattern

```sql
-- Add materialized path for efficient subtree queries
ALTER TABLE dav_component ADD COLUMN path TEXT;

-- Example paths:
-- VCALENDAR: "1"
-- VCALENDAR/VEVENT: "1.1"
-- VCALENDAR/VEVENT/VALARM: "1.1.1"

-- Efficient subtree query
CREATE INDEX idx_dav_component_path ON dav_component(path text_pattern_ops);

-- Query: WHERE path LIKE '1.1.%' (all children of VEVENT)
```

**Alternative: Closure Table**

```sql
CREATE TABLE dav_component_closure (
  ancestor_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  descendant_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  depth INT NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX idx_component_closure_desc ON dav_component_closure(descendant_id);
```

---

## 🟡 MEDIUM: Full-Text Search Improvements

### Problem

The `card_index.search_tsv` column exists but:
1. No trigger to auto-populate it
2. Doesn't include EMAIL, TEL values

### Recommended: Auto-Populate TSVector

```sql
-- Create trigger to maintain search_tsv
CREATE OR REPLACE FUNCTION update_card_search_tsv()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_tsv := 
    setweight(to_tsvector('simple', COALESCE(NEW.fn_, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.n_family, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.n_given, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.org, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_card_index_search
BEFORE INSERT OR UPDATE ON card_index
FOR EACH ROW EXECUTE FUNCTION update_card_search_tsv();

-- Include emails in search (requires LATERAL join from card_email)
```

---

## 🟡 MEDIUM: Alarm/Reminder Support

### Problem

No dedicated table for VALARM components. Querying upcoming alarms requires parsing all events.

### Recommended: Alarm Index Table

```sql
CREATE TABLE cal_alarm (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  parent_component_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  trigger_utc TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('DISPLAY', 'EMAIL', 'AUDIO')),
  acknowledged_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('cal_alarm');

COMMENT ON TABLE cal_alarm IS 'Derived index of VALARM triggers for notification scheduling';

CREATE INDEX idx_cal_alarm_trigger ON cal_alarm(trigger_utc) 
WHERE deleted_at IS NULL AND acknowledged_at IS NULL;

CREATE INDEX idx_cal_alarm_entity ON cal_alarm(entity_id);
```

---

## 🟡 MEDIUM: Principal Calendar/Addressbook URL Storage

### Problem

Principal-to-collection mapping is implicit (query by `owner_principal_id`). There's no direct storage of:
- `calendar-home-set` URL
- `addressbook-home-set` URL

### Recommended: Add URL Columns to Principal

```sql
ALTER TABLE principal 
  ADD COLUMN calendar_home_set TEXT,
  ADD COLUMN addressbook_home_set TEXT,
  ADD COLUMN schedule_inbox_url TEXT,
  ADD COLUMN schedule_outbox_url TEXT;

COMMENT ON COLUMN principal.calendar_home_set IS 'RFC 4791: calendar-home-set URL';
COMMENT ON COLUMN principal.addressbook_home_set IS 'RFC 6352: addressbook-home-set URL';
COMMENT ON COLUMN principal.schedule_inbox_url IS 'RFC 6638: schedule-inbox-URL';
COMMENT ON COLUMN principal.schedule_outbox_url IS 'RFC 6638: schedule-outbox-URL';
```

---

## 🟢 LOW: Audit Log Table

### Recommendation

For compliance and debugging, consider an append-only audit log:

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  principal_id UUID REFERENCES principal(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  old_value JSONB,
  new_value JSONB,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_principal ON audit_log(principal_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
```

---

## 🟢 LOW: Collection Statistics View

### Recommendation

For monitoring and quotas:

```sql
CREATE VIEW collection_stats AS
SELECT 
  c.id AS collection_id,
  c.owner_principal_id,
  c.collection_type,
  c.display_name,
  COUNT(DISTINCT i.id) FILTER (WHERE i.deleted_at IS NULL) AS instance_count,
  SUM(LENGTH(s.raw_canonical)) FILTER (WHERE s.deleted_at IS NULL) AS total_bytes,
  MAX(i.updated_at) AS last_modified
FROM dav_collection c
LEFT JOIN dav_instance i ON i.collection_id = c.id
LEFT JOIN dav_shadow s ON s.instance_id = i.id AND s.direction = 'outbound'
WHERE c.deleted_at IS NULL
GROUP BY c.id;

COMMENT ON VIEW collection_stats IS 'Collection size and activity metrics for quotas/monitoring';
```

---

## Migration Priority Order

1. **Immediate** (blocks sync-collection):
   - Tombstone sync_revision index
   - Instance sync query indexes

2. **Short-term** (improves query performance):
   - Denormalize collection_id to derived indexes
   - UID uniqueness constraint

3. **Medium-term** (improves RFC compliance):
   - Principal URL columns
   - Alarm index table
   - VTIMEZONE optimization

4. **Long-term** (nice to have):
   - Component tree optimization (materialized path)
   - Audit log
   - Collection statistics view

---

## Notes

- All migrations should be backwards-compatible
- Consider creating migrations incrementally rather than one large migration
- Test with realistic data volumes (10K+ events per calendar)
- Run `EXPLAIN ANALYZE` on common queries after each index addition
