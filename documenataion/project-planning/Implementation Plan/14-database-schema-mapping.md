# 14. Database Schema Mapping

## 14.1 Entity-Instance Model

Shuriken separates canonical content from collection membership:

| Table | Purpose |
|-------|---------|
| `dav_collection` | Calendar/addressbook collections |
| `dav_entity` | Canonical content (icalendar/vcard) |
| `dav_instance` | Per-collection resource with URI and ETag |
| `dav_component` | Component tree (VCALENDAR→VEVENT→VALARM) |
| `dav_property` | Property storage with typed values |
| `dav_parameter` | Property parameters |

## 14.2 Storage Flow

**PUT Request**:
1. Parse and validate content
2. Create/update `dav_entity` with logical UID
3. Create/update `dav_instance` with URI and ETag
4. Upsert component tree into `dav_component`
5. Upsert properties into `dav_property`
6. Update derived indexes (`cal_index`, `card_index`)
7. Increment collection `synctoken`

## 14.3 Derived Indexes

### 14.3.1 Calendar Indexes

| Table | Purpose |
|-------|---------|
| `cal_index` | Query optimization: UID, time range, summary |
| `cal_occurrence` | Pre-expanded recurrence instances |

### 14.3.2 Address Book Indexes

| Table | Purpose |
|-------|---------|
| `card_index` | Primary vCard query index |
| `card_email` | Email address lookup |
| `card_phone` | Phone number lookup |

**card_index Schema**:

```sql
CREATE TABLE card_index (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
    
    -- Core identification
    uid TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'individual',  -- individual/group/org/location
    
    -- Primary display/search fields
    fn TEXT NOT NULL,                          -- Formatted name (required)
    fn_sort TEXT,                              -- SORT-AS value for FN
    
    -- Structured name components (flattened for search)
    n_family TEXT,
    n_given TEXT,
    n_additional TEXT,
    n_sort TEXT,                               -- SORT-AS value for N
    
    -- Organization info
    org_name TEXT,
    org_unit TEXT,                             -- First unit only
    title TEXT,
    role TEXT,
    
    -- Full-text search
    search_vector TSVECTOR,                    -- For PostgreSQL full-text
    
    -- Normalized text for collation-based matching
    fn_normalized TEXT,                        -- Lowercased/normalized for i;unicode-casemap
    
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON card_index (entity_id);
CREATE INDEX ON card_index (uid);
CREATE INDEX ON card_index (fn_normalized);
CREATE INDEX ON card_index (org_name);
CREATE INDEX ON card_index USING GIN (search_vector);
```

**card_email Schema**:

```sql
CREATE TABLE card_email (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    email_normalized TEXT NOT NULL,            -- Lowercased
    type_work BOOLEAN NOT NULL DEFAULT FALSE,
    type_home BOOLEAN NOT NULL DEFAULT FALSE,
    pref INTEGER                               -- PREF parameter value (1-100)
);

CREATE INDEX ON card_email (entity_id);
CREATE INDEX ON card_email (email_normalized);
CREATE INDEX ON card_email (email_normalized text_pattern_ops);  -- For prefix search
```

**card_phone Schema**:

```sql
CREATE TABLE card_phone (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    phone_normalized TEXT NOT NULL,            -- Digits only
    type_voice BOOLEAN NOT NULL DEFAULT FALSE,
    type_cell BOOLEAN NOT NULL DEFAULT FALSE,
    type_fax BOOLEAN NOT NULL DEFAULT FALSE,
    type_work BOOLEAN NOT NULL DEFAULT FALSE,
    type_home BOOLEAN NOT NULL DEFAULT FALSE,
    pref INTEGER
);

CREATE INDEX ON card_phone (entity_id);
CREATE INDEX ON card_phone (phone_normalized);
```

**Populating card_index**:

```rust
fn extract_card_index(vcard: &VCard) -> CardIndex {
    CardIndex {
        uid: vcard.get_property("UID").map(|p| p.value_text()).unwrap_or_default(),
        kind: vcard.get_property("KIND").map(|p| p.value_text()).unwrap_or("individual"),
        fn_value: vcard.get_required_property("FN").value_text(),
        fn_sort: vcard.get_property("FN").and_then(|p| p.get_param("SORT-AS")),
        n_family: extract_n_component(vcard, 0),
        n_given: extract_n_component(vcard, 1),
        n_additional: extract_n_component(vcard, 2),
        n_sort: vcard.get_property("N").and_then(|p| p.get_param("SORT-AS")),
        org_name: extract_org_name(vcard),
        org_unit: extract_org_unit(vcard),
        title: vcard.get_property("TITLE").map(|p| p.value_text()),
        role: vcard.get_property("ROLE").map(|p| p.value_text()),
        search_vector: build_search_vector(vcard),
        fn_normalized: normalize_unicode_casemap(&fn_value),
    }
}

fn normalize_unicode_casemap(s: &str) -> String {
    // Unicode Default Case Algorithm (simple case folding)
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .collect()
}
```

**Query Execution Using Indexes**:

```rust
fn execute_addressbook_query(
    collection_id: Uuid,
    filter: &Filter,
    conn: &mut DbConnection<'_>,
) -> Result<Vec<AddressObjectResource>> {
    let mut query = card_index::table
        .inner_join(dav_instance::table.on(
            card_index::entity_id.eq(dav_instance::entity_id)
        ))
        .filter(dav_instance::collection_id.eq(collection_id))
        .into_boxed();

    // Apply filter conditions
    for prop_filter in &filter.prop_filters {
        query = apply_prop_filter(query, prop_filter);
    }

    query.load(conn)
}

fn apply_prop_filter(
    query: BoxedQuery,
    pf: &PropFilter,
) -> BoxedQuery {
    match pf.name.to_uppercase().as_str() {
        "FN" => apply_text_match(query, card_index::fn_normalized, &pf.text_match),
        "EMAIL" => {
            // Join to card_email table
            // Apply text-match to email_normalized
        }
        "TEL" => {
            // Join to card_phone table
        }
        "ORG" => apply_text_match(query, card_index::org_name, &pf.text_match),
        "NICKNAME" | "NOTE" | "CATEGORIES" => {
            // Fall back to full-text search or raw property scan
        }
        _ => {
            // Unsupported filter: return CARDDAV:supported-filter error
            // Or fall back to scanning dav_property table
        }
    }
}
```

## 14.4 Tombstones

`dav_tombstone` tracks deleted resources for sync:
- `collection_id`, `uri`: Identify deleted resource
- `synctoken`, `sync_revision`: For sync-collection queries
- `deleted_at`: Cleanup scheduling

---
