# RFC Compliance Implementation Guide {#top}

**Purpose**: Comprehensive developer reference for implementing RFC compliance fixes in Shuriken  
**Status**: Definitive implementation guide - version 2.0  
**Last Updated**: 2026-01-29

---

## Table of Contents {#table-of-contents}

- [Overview](#overview)
- [Quick Reference](#quick-reference)
- [Implementation Phases](#implementation-phases)
  - [Phase 0 (P0): Critical Fixes](#phase-0)
  - [Phase 1 (P1): Core Compliance](#phase-1)
  - [Phase 2 (P2): Enhanced Features](#phase-2)
  - [Phase 3 (P3): Advanced Features](#phase-3)
- [Implementation Patterns](#implementation-patterns)
  - [Pattern 1: Live Property Generators](#pattern-1)
  - [Pattern 2: Precondition Error XML Builders](#pattern-2)
  - [Pattern 3: CardDAV Error Elements](#pattern-3)
  - [Pattern 4: ACL Property Serialization](#pattern-4)
  - [Pattern 5: Need-Privileges Error Element](#pattern-5)
  - [Pattern 6: Text-Match Collation Integration](#pattern-6)
  - [Pattern 7: Sync-Token Retention Validation](#pattern-7)
  - [Pattern 8: Selective Calendar-Data Serialization](#pattern-8)
- [Testing Strategy](#testing-strategy)
- [Deployment Checklist](#deployment-checklist)
- [Rollout Plan](#rollout-plan)

---

## Overview {#overview}

This guide provides concrete implementation patterns for all RFC compliance fixes required in Shuriken. It combines architectural patterns with working code examples, test strategies, and deployment considerations.

### What This Guide Covers

1. **8 Core Implementation Patterns** - Reusable code patterns with full examples
2. **4 Implementation Phases** - Organized by priority (P0 → P3)
3. **RFC References** - Direct citations to relevant specifications
4. **Codebase Locations** - File paths in Shuriken's architecture
5. **Integration Examples** - How patterns connect with existing code
6. **Test Examples** - Unit and integration test patterns
7. **Deployment Strategy** - Rollout plan and validation checklist

### Key RFCs Covered

- **RFC 4918**: WebDAV - Core protocol, PROPFIND, error responses
- **RFC 3744**: WebDAV ACL - Access control, DAV:acl property, need-privileges errors
- **RFC 4791**: CalDAV - Calendar queries, filters, precondition errors
- **RFC 6352**: CardDAV - Address data, vCard validation
- **RFC 6578**: Collection Synchronization - sync-collection, sync-token validation
- **RFC 4790**: Collations - i;unicode-casemap text matching
- **RFC 3253**: Versioning - supported-report-set property
- **RFC 5545**: iCalendar - Component validation, property serialization
- **RFC 6350**: vCard - Contact data format

### Document Conventions

- ✅ **IMPLEMENTED** - Pattern is already deployed in codebase
- 🔧 **IN PROGRESS** - Pattern is partially implemented
- 📋 **PLANNED** - Pattern is documented but not yet started
- Code blocks show actual Rust implementation
- File paths use format: `[file.rs](path/to/file.rs)`

---

## Quick Reference {#quick-reference}

### Common Tasks

| Task | Pattern | Phase | File Location |
|------|---------|-------|---------------|
| Add live property to PROPFIND | [Pattern 1](#pattern-1) | P0/P1 | `src/component/rfc/dav/core/property/discovery.rs` |
| Return precondition error on PUT | [Pattern 2](#pattern-2) | P0 | `src/component/caldav/error.rs` |
| Serialize ACL from Casbin | [Pattern 4](#pattern-4) ✅ | P1 | `crates/shuriken-service/src/auth/acl.rs` |
| Validate calendar-query filter | Pattern 3.1 | P2 | `src/component/caldav/service/filter_capabilities.rs` |
| Apply text-match collation | [Pattern 6](#pattern-6) | P2 | `src/component/rfc/filters/collation.rs` |
| Selective component serialization | [Pattern 8](#pattern-8) | P2 | `src/component/db/map/serialize_with_selector.rs` |
| Validate sync-token age | [Pattern 7](#pattern-7) | P2 | `src/component/rfc/validation/sync.rs` |
| Return need-privileges on 403 | [Pattern 5](#pattern-5) | P1 | `src/component/rfc/dav/core/error.rs` |

### RFC Lookup

| Feature | RFC Section | Implementation Status |
|---------|-------------|----------------------|
| supported-report-set | RFC 3253 §3.1.5 | ✅ Implemented |
| supported-calendar-component-set | RFC 4791 §5.2.3 | ✅ Implemented |
| DAV:acl property | RFC 3744 §5.5 | ✅ Implemented (2026-01-30) |
| no-uid-conflict | RFC 4791 §5.3.2.1 | 📋 Pattern available |
| need-privileges | RFC 3744 §7.1.1 | 📋 Pattern available |
| valid-sync-token | RFC 6578 §4.1 | 📋 Pattern available |
| i;unicode-casemap | RFC 4790 §9.3 | 📋 Pattern available |
| calendar-data filtering | RFC 4791 §9.6 | 📋 Pattern available |

---

## Implementation Phases {#implementation-phases}

### Phase 0 (P0): Critical Fixes - 1 Hour {#phase-0}

**Goal**: Fix immediate RFC violations that break standard clients

**Changes**:
1. ✅ Remove LOCK/UNLOCK from DAV header (RFC 4918) - COMPLETE (2026-01-29)
2. Add `supported-report-set` property (RFC 3253 §3.1.5)
3. Fix PROPFIND to return minimal live properties

**Files Modified**:
- `src/app/api/dav/method/options.rs` - Remove LOCK/UNLOCK
- `src/component/rfc/dav/core/property/discovery.rs` - Add property generators
- `src/app/api/dav/method/propfind/helpers.rs` - Integrate properties

**Testing**: Manual smoke test with CalDAV Tester + unit tests

**Rollback Plan**: Revert single commit

---

### Phase 1 (P1): Core Compliance - 1 Week {#phase-1}

**Goal**: Implement essential RFC compliance for standard client compatibility

**Changes**:
1. All live property generators ([Pattern 1](#pattern-1))
2. CalDAV/CardDAV precondition errors ([Pattern 2](#pattern-2), [Pattern 3](#pattern-3))
3. ACL property serialization ([Pattern 4](#pattern-4))
4. need-privileges error responses ([Pattern 5](#pattern-5))

**Files Created/Modified**:
- `src/component/rfc/dav/core/property/discovery.rs` - Property generators
- `src/component/caldav/error.rs` - CalDAV errors
- `src/component/carddav/error.rs` - CardDAV errors
- `src/component/auth/acl_properties.rs` - ACL serialization
- `src/component/rfc/dav/core/error.rs` - need-privileges generator
- Integration points in all DAV method handlers

**Testing**: 
- 15+ unit tests for property/error generation
- 10+ integration tests for end-to-end flows
- CalDAV Tester validation

**Monitoring**: Track 403/409 error rates, client compatibility reports

---

### Phase 2 (P2): Enhanced Features - 1 Week {#phase-2}

**Goal**: Advanced query and sync features

**Changes**:
1. Filter capability validation (RFC 4791 §7.5)
2. Text-match collation ([Pattern 6](#pattern-6))
3. Sync-token retention validation ([Pattern 7](#pattern-7))
4. Selective serialization ([Pattern 8](#pattern-8))

**Files Created/Modified**:
- `src/component/caldav/service/filter_capabilities.rs` - Filter registry
- `src/component/rfc/filters/collation.rs` - Collation matching
- `src/component/rfc/validation/sync.rs` - Token validation
- `src/component/db/map/serialize_with_selector.rs` - Selective serialization

**Testing**:
- Complex calendar-query tests with filters
- Text matching with multiple collations
- Sync-collection with expired tokens
- Partial component retrieval tests

**Performance**: Benchmark query execution, serialization overhead

---

### Phase 3 (P3): Advanced Features - 2 Weeks {#phase-3}

**Goal**: Complete RFC feature set

**Changes**:
1. Expanded timezone support
2. Recurrence expansion optimization
3. Free/busy aggregation
4. Advanced CardDAV queries
5. Scheduling extensions (RFC 6638)

**Files**: Multiple new service modules, optimization of existing queries

**Testing**: Full CalDAV/CardDAV conformance test suite

---

## Implementation Patterns {#implementation-patterns}

### Pattern 1: Live Property Generators {#pattern-1}

**Status**: ✅ IMPLEMENTED (2026-01-29)  
**Location**: [`src/component/rfc/dav/core/property/discovery.rs`](../../src/component/rfc/dav/core/property/discovery.rs)  
**Integration**: [`src/app/api/dav/method/propfind/helpers.rs`](../../src/app/api/dav/method/propfind/helpers.rs)  
**RFC References**: RFC 4791 §5.2.3, §7.5.1; RFC 6352 §6.2.2; RFC 3253 §3.1.5  
**Tests**: 7 unit tests + 5 integration tests

#### Problem

CalDAV/CardDAV clients query for discovery properties via PROPFIND to understand server capabilities. These properties must be generated dynamically based on collection type and server features.

#### Solution

Create dedicated property generator functions that return properly namespaced XML strings.

#### Implementation

```rust
// src/component/rfc/dav/core/property/discovery.rs

use crate::component::dav::xml::*;

pub struct DiscoveryProperties;

impl DiscoveryProperties {
    /// RFC 3253 / RFC 4791: DAV:supported-report-set
    /// Returns available REPORT methods for CalDAV collections
    pub fn supported_report_set_caldav() -> String {
        r#"
        <D:supported-report-set xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
            <D:supported-report>
                <D:report><C:calendar-query/></D:report>
                <D:description>Query events/todos with filtering</D:description>
            </D:supported-report>
            <D:supported-report>
                <D:report><C:calendar-multiget/></D:report>
                <D:description>Retrieve multiple calendar resources by URI</D:description>
            </D:supported-report>
            <D:supported-report>
                <D:report><D:sync-collection/></D:report>
                <D:description>Synchronize calendar with changes</D:description>
            </D:supported-report>
        </D:supported-report-set>
        "#.to_string()
    }

    /// RFC 3253 / RFC 6352: DAV:supported-report-set for CardDAV
    pub fn supported_report_set_carddav() -> String {
        r#"
        <D:supported-report-set xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
            <D:supported-report>
                <D:report><CR:addressbook-query/></D:report>
                <D:description>Query contacts with filtering</D:description>
            </D:supported-report>
            <D:supported-report>
                <D:report><CR:addressbook-multiget/></D:report>
                <D:description>Retrieve multiple address objects by URI</D:description>
            </D:supported-report>
            <D:supported-report>
                <D:report><D:sync-collection/></D:report>
                <D:description>Synchronize addressbook with changes</D:description>
            </D:supported-report>
        </D:supported-report-set>
        "#.to_string()
    }

    /// RFC 4791 §5.2.3: CALDAV:supported-calendar-component-set
    pub fn supported_calendar_component_set() -> String {
        r#"
        <C:supported-calendar-component-set xmlns:C="urn:ietf:params:xml:ns:caldav">
            <C:comp name="VEVENT"/>
            <C:comp name="VTODO"/>
            <C:comp name="VJOURNAL"/>
        </C:supported-calendar-component-set>
        "#.to_string()
    }

    /// RFC 4791 §5.2.4: CALDAV:supported-calendar-data
    pub fn supported_calendar_data() -> String {
        r#"
        <C:supported-calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav">
            <C:calendar-data type="text/calendar" version="2.0"/>
        </C:supported-calendar-data>
        "#.to_string()
    }

    /// RFC 6352 §6.2.2: CARDDAV:supported-address-data
    pub fn supported_address_data() -> String {
        r#"
        <CR:supported-address-data xmlns:CR="urn:ietf:params:xml:ns:carddav">
            <CR:address-data-type type="text/vcard" version="3.0"/>
            <CR:address-data-type type="text/vcard" version="4.0"/>
        </CR:supported-address-data>
        "#.to_string()
    }

    /// RFC 4791 §5.2.5: CALDAV:max-resource-size
    #[must_use]
    pub fn max_resource_size(size_bytes: u64) -> String {
        format!(
            "<C:max-resource-size xmlns:C=\"urn:ietf:params:xml:ns:caldav\">{}</C:max-resource-size>",
            size_bytes
        )
    }

    /// RFC 4791 §7.5.1: CALDAV:supported-collation-set
    pub fn supported_collation_set() -> String {
        r#"
        <C:supported-collation-set xmlns:C="urn:ietf:params:xml:ns:caldav">
            <C:supported-collation>i;octet</C:supported-collation>
            <C:supported-collation>i;ascii-casemap</C:supported-collation>
            <C:supported-collation>i;unicode-casemap</C:supported-collation>
        </C:supported-collation-set>
        "#.to_string()
    }
}
```

#### Integration into PROPFIND Response

```rust
// src/app/api/dav/method/propfind/helpers.rs

use crate::component::rfc::dav::core::property::discovery::*;

fn handle_propfind_on_calendar_collection(
    collection: &Collection,
    requested_props: &[String],
) -> Result<LiveProperties, Error> {
    let mut props = LiveProperties::new();
    
    // ... existing properties ...
    
    if requested_props.contains(&"DAV:supported-report-set".to_string()) 
        || requested_props.is_empty() {  // allprop request
        props.insert(
            "DAV:supported-report-set".to_string(),
            DiscoveryProperties::supported_report_set_caldav()
        );
    }
    
    if requested_props.contains(&"CALDAV:supported-calendar-component-set".to_string()) {
        props.insert(
            "CALDAV:supported-calendar-component-set".to_string(),
            DiscoveryProperties::supported_calendar_component_set()
        );
    }
    
    if requested_props.contains(&"CALDAV:supported-calendar-data".to_string()) {
        props.insert(
            "CALDAV:supported-calendar-data".to_string(),
            DiscoveryProperties::supported_calendar_data()
        );
    }

    if requested_props.contains(&"CALDAV:supported-collation-set".to_string()) {
        props.insert(
            "CALDAV:supported-collation-set".to_string(),
            DiscoveryProperties::supported_collation_set()
        );
    }
    
    Ok(props)
}
```

#### Testing

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_report_set_caldav_contains_required_reports() {
        let xml = DiscoveryProperties::supported_report_set_caldav();
        
        assert!(xml.contains("calendar-query"));
        assert!(xml.contains("calendar-multiget"));
        assert!(xml.contains("sync-collection"));
    }

    #[test]
    fn test_supported_calendar_component_set_lists_components() {
        let xml = DiscoveryProperties::supported_calendar_component_set();
        
        assert!(xml.contains("VEVENT"));
        assert!(xml.contains("VTODO"));
        assert!(xml.contains("VJOURNAL"));
    }

    #[test]
    fn test_max_resource_size_formats_correctly() {
        let xml = DiscoveryProperties::max_resource_size(10485760);
        assert!(xml.contains("10485760"));
    }
}
```

#### Integration Test

```rust
#[test_log::test(tokio::test)]
async fn propfind_returns_supported_report_set() {
    let test_db = setup_test_db().await;
    let calendar = create_test_calendar(&test_db).await;
    
    let req = build_propfind_request(&calendar, &["supported-report-set"]);
    let res = execute_request(req).await;
    
    assert_eq!(res.status(), 207);  // Multi-Status
    
    let body = res.text().await;
    assert!(body.contains("calendar-query"));
    assert!(body.contains("calendar-multiget"));
    assert!(body.contains("sync-collection"));
}
```

---

### Pattern 2: Precondition Error XML Builders {#pattern-2}

**Status**: 📋 PLANNED  
**Location**: [`src/component/caldav/error.rs`](../../src/component/caldav/error.rs)  
**RFC References**: RFC 4791 §5.3.2.1, §9.1.1  
**Phase**: P1

#### Problem

CalDAV PUT requests must validate iCalendar data and return specific precondition error elements when validation fails. Clients rely on these error details to provide meaningful feedback.

#### Solution

Create structured error builders that generate RFC-compliant XML error bodies.

#### Implementation

```rust
// src/component/caldav/error.rs

pub struct CalDAVErrors;

impl CalDAVErrors {
    /// RFC 4791 §5.3.2.1: Unsupported component type
    /// Status: 409 Conflict when creating VJOURNAL but only VEVENT supported
    pub fn unsupported_component(component_type: &str, supported: &[&str]) -> String {
        let supported_comps = supported
            .iter()
            .map(|c| format!("<C:comp name=\"{}\"/>", c))
            .collect::<Vec<_>>()
            .join("");
        
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                <C:supported-calendar-component>
                    <C:comp name="{}"/>
                    {}
                </C:supported-calendar-component>
            </D:error>
            "#,
            component_type, supported_comps
        )
    }

    /// RFC 4791 §5.3.2.1: Invalid iCalendar data
    /// Status: 403 Forbidden when PRODID or VERSION missing
    pub fn invalid_calendar_data(reason: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                <C:valid-calendar-data>
                    <D:description>{}</D:description>
                </C:valid-calendar-data>
            </D:error>
            "#,
            xml_escape(reason)
        )
    }

    /// RFC 4791 §5.3.2.1: Unsupported media type
    /// Status: 409 Conflict when Content-Type not text/calendar
    pub fn unsupported_media_type(content_type: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                <C:supported-calendar-data>
                    <D:description>Expected text/calendar, got {}</D:description>
                </C:supported-calendar-data>
            </D:error>
            "#,
            xml_escape(content_type)
        )
    }

    /// RFC 4791 §5.3.2.1: UID conflict
    /// Status: 409 Conflict when UID already exists in collection
    pub fn uid_conflict(uid: &str, existing_href: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                <C:no-uid-conflict>
                    <D:href>{}</D:href>
                </C:no-uid-conflict>
            </D:error>
            "#,
            xml_escape(existing_href)
        )
    }

    /// RFC 4791 §9.1.1: Resource must be inside calendar collection
    /// Status: 409 Conflict on PUT outside calendar
    pub fn resource_must_be_calendar_object_resource() -> String {
        r#"
        <D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
            <C:valid-calendar-object-resource>
                <D:description>Resource must be inside a calendar collection</D:description>
            </C:valid-calendar-object-resource>
        </D:error>
        "#.to_string()
    }

    /// RFC 4791 §5.3.2.1: Component exceeds maximum size
    /// Status: 403 Forbidden when resource too large
    pub fn max_resource_size_exceeded(size: usize, max_size: usize) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                <C:max-resource-size/>
                <D:description>Resource size {} exceeds maximum {}</D:description>
            </D:error>
            "#,
            size, max_size
        )
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
```

#### Integration into PUT Handler

```rust
// src/app/api/dav/method/put/handlers.rs

use crate::component::caldav::error::CalDAVErrors;

async fn put_calendar_resource(
    collection: &Collection,
    resource_name: &str,
    body: &str,
    content_type: &str,
) -> Result<StatusCode, (StatusCode, String)> {
    // Validate content type
    if !content_type.starts_with("text/calendar") {
        return Err((
            StatusCode::CONFLICT,
            CalDAVErrors::unsupported_media_type(content_type),
        ));
    }

    // Check resource size
    if body.len() > collection.max_resource_size {
        return Err((
            StatusCode::FORBIDDEN,
            CalDAVErrors::max_resource_size_exceeded(
                body.len(),
                collection.max_resource_size
            ),
        ));
    }

    // Parse iCalendar
    let ical = parse_ical(body)
        .map_err(|e| {
            (
                StatusCode::FORBIDDEN,
                CalDAVErrors::invalid_calendar_data(&e.to_string()),
            )
        })?;

    // Validate component type
    let supported = &["VEVENT", "VTODO", "VJOURNAL"];
    if !supported.contains(&ical.component_type.as_str()) {
        return Err((
            StatusCode::CONFLICT,
            CalDAVErrors::unsupported_component(&ical.component_type, supported),
        ));
    }

    // Check UID uniqueness
    if let Some(existing) = collection.find_resource_by_uid(&ical.uid).await? {
        if existing.name != resource_name {
            return Err((
                StatusCode::CONFLICT,
                CalDAVErrors::uid_conflict(&ical.uid, &existing.href),
            ));
        }
    }

    // ... rest of PUT logic ...
    Ok(StatusCode::CREATED)
}
```

#### Testing

```rust
#[test_log::test(tokio::test)]
async fn put_uid_conflict_returns_error_xml() {
    let test_db = setup_test_db().await;
    let collection = create_test_calendar(&test_db).await;
    
    // Create first event
    let ics1 = create_test_event_with_uid("uid-123");
    put_resource(&collection, "event1.ics", ics1).await.unwrap();
    
    // Try to create second event with same UID
    let ics2 = create_test_event_with_uid("uid-123");
    let res = put_resource(&collection, "event2.ics", ics2).await;
    
    assert_eq!(res.status(), 409);  // Conflict
    
    let body = res.text().await;
    assert!(body.contains("no-uid-conflict"));
    assert!(body.contains("event1.ics"));  // Should reference existing resource
}

#[test_log::test(tokio::test)]
async fn put_invalid_content_type_returns_error() {
    let test_db = setup_test_db().await;
    let collection = create_test_calendar(&test_db).await;
    
    let res = put_resource_with_content_type(
        &collection,
        "event.ics",
        "some data",
        "text/plain"
    ).await;
    
    assert_eq!(res.status(), 409);
    
    let body = res.text().await;
    assert!(body.contains("supported-calendar-data"));
}
```

---

### Pattern 3: CardDAV Error Elements {#pattern-3}

**Status**: 📋 PLANNED  
**Location**: [`src/component/carddav/error.rs`](../../src/component/carddav/error.rs)  
**RFC References**: RFC 6352 §6.3.2.1  
**Phase**: P1

#### Problem

CardDAV has its own precondition errors for vCard validation failures.

#### Solution

Parallel error builder to CalDAV but for CardDAV namespace.

#### Implementation

```rust
// src/component/carddav/error.rs

pub struct CardDAVErrors;

impl CardDAVErrors {
    /// RFC 6352 §6.3.2.1: Invalid vCard data
    pub fn invalid_address_data(reason: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
                <CR:valid-address-data>
                    <D:description>{}</D:description>
                </CR:valid-address-data>
            </D:error>
            "#,
            xml_escape(reason)
        )
    }

    /// RFC 6352 §6.3.2.1: UID conflict
    pub fn uid_conflict(uid: &str, existing_href: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
                <CR:no-uid-conflict>
                    <D:href>{}</D:href>
                </CR:no-uid-conflict>
            </D:error>
            "#,
            xml_escape(existing_href)
        )
    }

    /// RFC 6352 §5.1.1: Media type conversion error
    pub fn unsupported_address_data_conversion(from: &str, to: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
                <CR:supported-address-data>
                    <D:description>Cannot convert from {} to {}</D:description>
                </CR:supported-address-data>
            </D:error>
            "#,
            xml_escape(from),
            xml_escape(to)
        )
    }

    /// RFC 6352 §6.3.2.1: Unsupported media type
    pub fn unsupported_media_type(content_type: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
                <CR:supported-address-data>
                    <D:description>Expected text/vcard, got {}</D:description>
                </CR:supported-address-data>
            </D:error>
            "#,
            xml_escape(content_type)
        )
    }

    /// RFC 6352 §6.3.2.1: Maximum size exceeded
    pub fn max_resource_size_exceeded(size: usize, max_size: usize) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
                <CR:max-resource-size/>
                <D:description>vCard size {} exceeds maximum {}</D:description>
            </D:error>
            "#,
            size, max_size
        )
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
```

#### Integration

```rust
// src/app/api/dav/method/put/handlers.rs (CardDAV section)

use crate::component::carddav::error::CardDAVErrors;

async fn put_vcard_resource(
    addressbook: &Addressbook,
    resource_name: &str,
    body: &str,
    content_type: &str,
) -> Result<StatusCode, (StatusCode, String)> {
    // Validate content type
    if !content_type.starts_with("text/vcard") {
        return Err((
            StatusCode::CONFLICT,
            CardDAVErrors::unsupported_media_type(content_type),
        ));
    }

    // Parse vCard
    let vcard = parse_vcard(body)
        .map_err(|e| {
            (
                StatusCode::FORBIDDEN,
                CardDAVErrors::invalid_address_data(&e.to_string()),
            )
        })?;

    // Check UID uniqueness
    if let Some(existing) = addressbook.find_resource_by_uid(&vcard.uid).await? {
        if existing.name != resource_name {
            return Err((
                StatusCode::CONFLICT,
                CardDAVErrors::uid_conflict(&vcard.uid, &existing.href),
            ));
        }
    }

    // ... rest of PUT logic ...
    Ok(StatusCode::CREATED)
}
```

---

### Pattern 4: ACL Property Serialization ✅ IMPLEMENTED {#pattern-4}

**Status**: ✅ IMPLEMENTED (2026-01-30)  
**Location**: [`crates/shuriken-service/src/auth/acl.rs`](../../crates/shuriken-service/src/auth/acl.rs)  
**Integration**: [`crates/shuriken-app/src/app/api/dav/method/propfind/helpers.rs`](../../crates/shuriken-app/src/app/api/dav/method/propfind/helpers.rs#L139-L149)  
**Tests**: [`crates/shuriken-test/tests/integration/acl_pseudo_principals.rs`](../../crates/shuriken-test/tests/integration/acl_pseudo_principals.rs)  
**RFC References**: RFC 3744 §5.5 (DAV:acl property), §5.5.1 (pseudo-principals), §5.8 (supported-privilege-set)  
**Phase**: P1

#### Problem

Clients use PROPFIND to query `DAV:acl` property to understand access permissions. Shuriken stores ACL policies in Casbin but must serialize them to RFC 3744 XML format.

#### Solution

Create a converter that translates Casbin policies to DAV:acl XML structure.

#### Implementation

```rust
// src/component/auth/acl_properties.rs

use crate::component::auth::casbin::CasbinEnforcer;
use crate::component::model::principal::Principal;
use crate::component::db::DbConnection;

pub struct ACLSerializer;

impl ACLSerializer {
    /// ## Summary
    /// RFC 3744 §5.5: Generate DAV:acl property from Casbin policies
    ///
    /// ## Errors
    /// Returns error if enforcer query fails
    pub async fn serialize_acl(
        resource_path: &str,
        enforcer: &CasbinEnforcer,
        conn: &mut DbConnection<'_>,
    ) -> anyhow::Result<String> {
        // Get all policies matching this resource
        let policies = enforcer.get_policies_for_resource(resource_path).await?;
        
        let mut xml = r#"<?xml version="1.0" encoding="utf-8"?>
<D:acl xmlns:D="DAV:">"#.to_string();
        
        for policy in policies {
            let principal_xml = Self::serialize_principal(&policy.subject, conn).await?;
            let privileges_xml = Self::serialize_privileges(&policy.action);
            
            xml.push_str(&format!(
                r#"
  <D:ace>
    {}
    <D:grant>
      {}
    </D:grant>
  </D:ace>"#,
                principal_xml, privileges_xml
            ));
        }
        
        xml.push_str("\n</D:acl>");
        Ok(xml)
    }

    /// ## Summary
    /// Map Casbin subject (user UUID, group UUID, "public") to RFC principal
    ///
    /// ## Errors
    /// Returns error if principal lookup fails
    async fn serialize_principal(
        subject: &str,
        conn: &mut DbConnection<'_>,
    ) -> anyhow::Result<String> {
        if subject == "public" {
            Ok("<D:principal><D:authenticated/></D:principal>".to_string())
        } else if let Ok(uuid) = uuid::Uuid::parse_str(subject) {
            // Look up principal to determine if user or group
            use crate::component::db::query::principal;
            use diesel::prelude::*;
            
            let principal = principal::by_id(uuid)
                .first::<Principal>(conn)
                .await?;
            
            match principal.kind.as_str() {
                "user" => Ok(format!(
                    "<D:principal><D:href>/principals/users/{}</D:href></D:principal>",
                    uuid
                )),
                "group" => Ok(format!(
                    "<D:principal><D:href>/principals/groups/{}</D:href></D:principal>",
                    uuid
                )),
                _ => Ok("<D:principal><D:authenticated/></D:principal>".to_string()),
            }
        } else {
            Ok("<D:principal><D:authenticated/></D:principal>".to_string())
        }
    }

    /// ## Summary
    /// Map Casbin action to RFC privileges
    #[must_use]
    fn serialize_privileges(action: &str) -> String {
        match action {
            "read" => "<D:privilege><D:read/></D:privilege>".to_string(),
            "write" => "<D:privilege><D:write/></D:privilege>".to_string(),
            "admin" => "<D:privilege><D:all/></D:privilege>".to_string(),
            "read-acl" => "<D:privilege><D:read-acl/></D:privilege>".to_string(),
            _ => "<D:privilege><D:read/></D:privilege>".to_string(),
        }
    }

    /// ## Summary
    /// RFC 3744 §5.8: Generate DAV:supported-privilege-set
    #[must_use]
    pub fn supported_privilege_set_xml() -> &'static str {
        r#"<?xml version="1.0" encoding="utf-8"?>
<D:supported-privilege-set xmlns:D="DAV:">
  <D:supported-privilege>
    <D:privilege><D:all/></D:privilege>
    <D:abstract/>
    <D:description xml:lang="en">Aggregate of all privileges</D:description>
    <D:supported-privilege>
      <D:privilege><D:read/></D:privilege>
      <D:description xml:lang="en">Read resource content and properties</D:description>
    </D:supported-privilege>
    <D:supported-privilege>
      <D:privilege><D:write/></D:privilege>
      <D:description xml:lang="en">Write resource content and properties</D:description>
      <D:supported-privilege>
        <D:privilege><D:write-content/></D:privilege>
        <D:description xml:lang="en">Write resource content</D:description>
      </D:supported-privilege>
      <D:supported-privilege>
        <D:privilege><D:write-properties/></D:privilege>
        <D:description xml:lang="en">Write resource properties</D:description>
      </D:supported-privilege>
    </D:supported-privilege>
    <D:supported-privilege>
      <D:privilege><D:read-acl/></D:privilege>
      <D:description xml:lang="en">Read resource ACL</D:description>
    </D:supported-privilege>
    <D:supported-privilege>
      <D:privilege><D:write-acl/></D:privilege>
      <D:description xml:lang="en">Write resource ACL (NOT SUPPORTED)</D:description>
      <D:abstract/>
    </D:supported-privilege>
  </D:supported-privilege>
</D:supported-privilege-set>"#
    }
}
```

#### Integration into PROPFIND

```rust
// src/app/api/dav/method/propfind/helpers.rs

use crate::component::auth::acl_properties::ACLSerializer;

// In PROPFIND handler - add ACL property
if requested_props.contains(&"DAV:acl".to_string()) 
    || requested_props.is_empty() {
    let acl_xml = ACLSerializer::serialize_acl(
        resource_path,
        &enforcer,
        conn
    ).await?;
    
    props.insert("DAV:acl".to_string(), acl_xml);
}

if requested_props.contains(&"DAV:supported-privilege-set".to_string()) {
    props.insert(
        "DAV:supported-privilege-set".to_string(),
        ACLSerializer::supported_privilege_set_xml().to_string()
    );
}
```

#### Testing

```rust
#[test_log::test(tokio::test)]
async fn propfind_acl_returns_user_permissions() {
    let test_db = setup_test_db().await;
    let (user, calendar) = create_user_with_calendar(&test_db).await;
    
    // Add read permission for user
    add_casbin_policy(&user.id, &calendar.path, "read").await;
    
    let req = build_propfind_request(&calendar, &["DAV:acl"]);
    let res = execute_request(req).await;
    
    let body = res.text().await;
    assert!(body.contains(&user.id.to_string()));
    assert!(body.contains("<D:read/>"));
}
```

---

### Pattern 5: Need-Privileges Error Element {#pattern-5}

**Status**: 📋 PLANNED  
**Location**: [`src/component/rfc/dav/core/error.rs`](../../src/component/rfc/dav/core/error.rs)  
**RFC References**: RFC 3744 §7.1.1  
**Phase**: P1

#### Problem

When authorization fails, clients need to know what specific privileges they're missing on which resources. RFC 3744 defines a structured error response for 403 Forbidden.

#### Solution

Build error XML that lists missing privileges per resource.

#### Implementation

```rust
// src/component/rfc/dav/core/error.rs

use crate::component::rfc::dav::core::Href;

/// Represents a required privilege that was denied
#[derive(Debug, Clone)]
pub struct PrivilegeRequired {
    pub href: Href,
    pub privilege: String,
}

pub struct ACLErrors;

impl ACLErrors {
    /// RFC 3744 §7.1.1: Report missing privileges on 403 Forbidden
    pub fn need_privileges(privileges_required: &[PrivilegeRequired]) -> String {
        let mut xml = String::from(
            r#"<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:">
  <D:need-privileges>"#
        );

        for req in privileges_required {
            xml.push_str(&format!(
                r#"
    <D:resource>
      <D:href>{}</D:href>
      <D:privilege>
        <D:{}/> 
      </D:privilege>
    </D:resource>"#,
                req.href.value,
                req.privilege
            ));
        }

        xml.push_str(
            r#"
  </D:need-privileges>
</D:error>"#
        );
        xml
    }
}
```

#### Integration into Authorization Check

```rust
// src/app/api/dav/method/get_head/handlers.rs

use crate::component::rfc::dav::core::error::{ACLErrors, PrivilegeRequired};
use crate::component::rfc::dav::core::Href;

async fn check_read_authorization(
    depot: &salvo::Depot,
    conn: &mut DbConnection<'_>,
    instance: &DavInstance,
    resource_href: &str,  // ← Client-visible path
) -> Result<(), AppError> {
    let subjects = get_subjects_from_depot(depot, conn).await?;
    let enforcer = get_enforcer();
    
    // Check authorization using UUID-based path
    let resolved_path = depot.get::<String>("RESOLVED_LOCATION").unwrap();
    
    if !enforcer.enforce_any(&subjects, resolved_path, "read").await? {
        // Return 403 with need-privileges error
        return Err(AppError::ForbiddenWithPrivileges {
            errors: vec![
                PrivilegeRequired {
                    href: Href::new(resource_href.to_string()),
                    privilege: "read".to_string(),
                }
            ],
        });
    }
    
    Ok(())
}

// In error handler
impl IntoResponse for AppError {
    fn into_response(self, res: &mut salvo::Response) {
        match self {
            AppError::ForbiddenWithPrivileges { errors } => {
                res.status_code(StatusCode::FORBIDDEN);
                res.add_header("Content-Type", "application/xml; charset=utf-8", true)
                    .unwrap();
                res.write_body(ACLErrors::need_privileges(&errors))
                    .unwrap();
            },
            // ... other errors
        }
    }
}
```

#### Testing

```rust
#[test_log::test(tokio::test)]
async fn get_without_permission_returns_need_privileges() {
    let test_db = setup_test_db().await;
    let (user1, user2) = create_two_users(&test_db).await;
    let calendar = create_calendar_for_user(&test_db, &user1).await;
    
    // user2 tries to access user1's calendar
    let res = get_resource_as_user(&calendar, "event.ics", &user2).await;
    
    assert_eq!(res.status(), 403);
    
    let body = res.text().await;
    assert!(body.contains("need-privileges"));
    assert!(body.contains("<D:read/>"));
    assert!(body.contains(&calendar.href()));
}
```

---

### Pattern 6: Text-Match Collation Integration {#pattern-6}

**Status**: 📋 PLANNED  
**Location**: [`src/component/rfc/filters/collation.rs`](../../src/component/rfc/filters/collation.rs)  
**RFC References**: RFC 4790 §9.3, RFC 4791 §9.7.5  
**Phase**: P2

#### Problem

CalDAV text-match filters support collations (comparison algorithms). RFC 4790 defines `i;unicode-casemap` which performs Unicode case-folding for case-insensitive comparison.

#### Solution

Use ICU library's case folding for proper Unicode normalization.

#### Implementation

```rust
// src/component/rfc/filters/collation.rs

use icu::casemap::CaseMapper;

pub struct CollationFilter;

impl CollationFilter {
    /// ## Summary
    /// RFC 4790 §9.3: Implement i;unicode-casemap collation
    /// Maps string to lowercase using Unicode case folding rules
    ///
    /// ## Errors
    /// Returns error if ICU case mapping fails
    pub fn unicode_casemap_normalize(s: &str) -> anyhow::Result<String> {
        let mapper = CaseMapper::new();
        
        // Use ICU's case folding (best for collation)
        let folded = mapper.fold_string(s);
        
        Ok(folded)
    }

    /// ## Summary
    /// Apply collation to text-match filter
    ///
    /// ## Errors
    /// Returns error if normalization fails
    pub fn matches(
        text: &str,
        pattern: &str,
        collation: &str,
        match_type: &str,
    ) -> anyhow::Result<bool> {
        // Normalize both sides using specified collation
        let (text_norm, pattern_norm) = match collation {
            "i;unicode-casemap" => (
                Self::unicode_casemap_normalize(text)?,
                Self::unicode_casemap_normalize(pattern)?,
            ),
            "i;ascii-casemap" => (
                text.to_lowercase(),
                pattern.to_lowercase(),
            ),
            "i;octet" => (text.to_string(), pattern.to_string()),
            _ => (
                text.to_string(),
                pattern.to_string(),
            ),
        };

        // Apply match type
        Ok(match match_type {
            "contains" => text_norm.contains(&pattern_norm),
            "starts-with" => text_norm.starts_with(&pattern_norm),
            "ends-with" => text_norm.ends_with(&pattern_norm),
            "equals" => text_norm == pattern_norm,
            _ => text_norm == pattern_norm,
        })
    }
}
```

#### Integration into Filter Evaluation

```rust
// src/component/caldav/service/query.rs

use crate::component::rfc::filters::collation::CollationFilter;

/// Evaluate text-match filter on component property
fn evaluate_text_match_filter(
    component: &Component,
    filter: &TextMatchFilter,
) -> anyhow::Result<bool> {
    let property_value = component
        .get_property_value(&filter.property_name)
        .unwrap_or_default();
    
    CollationFilter::matches(
        &property_value,
        &filter.pattern,
        &filter.collation,     // "i;unicode-casemap"
        &filter.match_type,    // "contains", "starts-with", etc.
    )
}
```

#### Testing

```rust
#[test]
fn test_unicode_casemap_turkish_i() {
    // Turkish has special case folding for I/i
    let result = CollationFilter::matches(
        "İstanbul",  // Turkish capital I with dot
        "istanbul",  // Lowercase i
        "i;unicode-casemap",
        "equals"
    ).unwrap();
    
    assert!(result, "Unicode case folding should match Turkish İ with i");
}

#[test]
fn test_ascii_casemap_basic() {
    let result = CollationFilter::matches(
        "Summary Text",
        "summary",
        "i;ascii-casemap",
        "contains"
    ).unwrap();
    
    assert!(result);
}

#[test_log::test(tokio::test)]
async fn calendar_query_with_text_match_collation() {
    let test_db = setup_test_db().await;
    let calendar = create_test_calendar(&test_db).await;
    
    create_event_with_summary(&calendar, "Café Meeting").await;
    create_event_with_summary(&calendar, "CAFE MEETING").await;
    
    // Query with unicode-casemap collation
    let filter = TextMatchFilter {
        property_name: "SUMMARY".to_string(),
        pattern: "café".to_string(),
        collation: "i;unicode-casemap".to_string(),
        match_type: "contains".to_string(),
        negate: false,
    };
    
    let results = execute_calendar_query(&calendar, filter).await;
    
    // Both should match with Unicode case folding
    assert_eq!(results.len(), 2);
}
```

---

### Pattern 7: Sync-Token Retention Validation {#pattern-7}

**Status**: 📋 PLANNED  
**Location**: [`src/component/rfc/validation/sync.rs`](../../src/component/rfc/validation/sync.rs)  
**RFC References**: RFC 6578 §4.1  
**Phase**: P2

#### Problem

sync-collection REPORT requires servers to maintain change history. If a client provides a sync-token older than the retention window, server must return a precondition error.

#### Solution

Track token age and validate against minimum retention period (7 days per RFC).

#### Implementation

```rust
// src/component/rfc/validation/sync.rs

use chrono::{DateTime, Utc, Duration};
use uuid::Uuid;

pub struct SyncTokenValidator;

impl SyncTokenValidator {
    /// ## Summary
    /// RFC 6578 §4.1: Validate sync-token is within retention window
    /// Minimum retention: 7 days per RFC 6578
    ///
    /// ## Errors
    /// Returns SyncTokenError if token is invalid or expired
    pub fn validate_sync_token(
        sync_token: &str,
        collection_id: &Uuid,
        db: &mut DbConnection<'_>,
    ) -> Result<(), SyncTokenError> {
        // Parse token (e.g., "1234567-1704067200")
        let (revision, timestamp) = Self::parse_token(sync_token)?;
        
        // Get current sync state
        let current = db.get_collection_sync_state(collection_id)?;
        
        // Check token is recent enough (7 days minimum)
        let token_age = Utc::now() - timestamp;
        if token_age > Duration::days(7) {
            // Token too old - retention window expired
            return Err(SyncTokenError::ValidSyncTokenPrecondition);
        }
        
        // Check token is not from the future
        if timestamp > Utc::now() {
            return Err(SyncTokenError::InvalidToken);
        }
        
        Ok(())
    }

    /// ## Summary
    /// Parse Shuriken sync token format
    ///
    /// ## Errors
    /// Returns error if token format is invalid
    fn parse_token(token: &str) -> Result<(i64, DateTime<Utc>), SyncTokenError> {
        // Token format: revision-timestamp (RFC 6578 defines opaque token)
        // Shuriken: "1234567-1704067200" (revision-unix_timestamp)
        let parts: Vec<&str> = token.split('-').collect();
        
        if parts.len() != 2 {
            return Err(SyncTokenError::InvalidToken);
        }
        
        let revision: i64 = parts[0]
            .parse()
            .map_err(|_| SyncTokenError::InvalidToken)?;
            
        let timestamp_secs: i64 = parts[1]
            .parse()
            .map_err(|_| SyncTokenError::InvalidToken)?;
            
        let timestamp = DateTime::<Utc>::from_timestamp(timestamp_secs, 0)
            .ok_or(SyncTokenError::InvalidToken)?;
        
        Ok((revision, timestamp))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SyncTokenError {
    #[error("Invalid sync token format")]
    InvalidToken,
    
    #[error("Sync token outside retention window")]
    ValidSyncTokenPrecondition,
}

/// Generate XML error for expired sync token
pub fn valid_sync_token_error() -> String {
    r#"<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:">
    <D:valid-sync-token/>
</D:error>"#.to_string()
}
```

#### Integration into sync-collection REPORT

```rust
// src/app/api/dav/method/report/sync_collection.rs

use crate::component::rfc::validation::sync::{SyncTokenValidator, valid_sync_token_error};

pub async fn handle_sync_collection(
    conn: &mut DbConnection<'_>,
    collection_id: Uuid,
    sync_token: Option<String>,
) -> Result<Multistatus, AppError> {
    // Validate sync token if provided
    if let Some(token) = &sync_token {
        if let Err(e) = SyncTokenValidator::validate_sync_token(token, &collection_id, conn) {
            match e {
                SyncTokenError::ValidSyncTokenPrecondition => {
                    return Err(AppError::PreconditionFailed {
                        body: valid_sync_token_error(),
                    });
                },
                SyncTokenError::InvalidToken => {
                    return Err(AppError::BadRequest {
                        reason: "Invalid sync token format".to_string(),
                    });
                }
            }
        }
    }
    
    // Proceed with sync-collection logic
    execute_sync_query(conn, collection_id, sync_token).await
}
```

#### Testing

```rust
#[test]
fn test_parse_valid_token() {
    let token = "123456-1704067200";
    let result = SyncTokenValidator::parse_token(token);
    assert!(result.is_ok());
}

#[test]
fn test_parse_invalid_token_format() {
    let token = "invalid-token-format-12345";
    let result = SyncTokenValidator::parse_token(token);
    assert!(result.is_err());
}

#[test_log::test(tokio::test)]
async fn sync_collection_with_expired_token_returns_precondition() {
    let test_db = setup_test_db().await;
    let calendar = create_test_calendar(&test_db).await;
    
    // Create token from 8 days ago (outside 7-day window)
    let old_timestamp = Utc::now() - Duration::days(8);
    let expired_token = format!("123-{}", old_timestamp.timestamp());
    
    let res = sync_collection(&calendar, Some(expired_token)).await;
    
    assert_eq!(res.status(), 412);  // Precondition Failed
    
    let body = res.text().await;
    assert!(body.contains("valid-sync-token"));
}
```

---

### Pattern 8: Selective Calendar-Data Serialization {#pattern-8}

**Status**: 📋 PLANNED  
**Location**: [`src/component/db/map/serialize_with_selector.rs`](../../src/component/db/map/serialize_with_selector.rs)  
**RFC References**: RFC 4791 §9.6  
**Phase**: P2

#### Problem

calendar-query and calendar-multiget can request partial calendar data (specific components/properties). Server must serialize only the requested parts while maintaining valid iCalendar structure.

#### Solution

Tree traversal with selective inclusion based on client request.

#### Implementation

```rust
// src/component/db/map/serialize_with_selector.rs

use crate::component::rfc::ical::core::{ComponentKind, Property};
use crate::component::rfc::dav::caldav::CalendarDataRequest;
use crate::component::model::dav::component::ComponentNode;

/// ## Summary
/// Serializes an iCalendar component tree with selective property/component inclusion.
///
/// Respects RFC 4791 §9.6 partial retrieval semantics:
/// - If allcomp requested, includes all components
/// - If comp with specific children requested, includes only those children
/// - If allprop requested, includes all properties  
/// - If prop with specific names requested, includes only those properties
///
/// ## Errors
/// Returns serialization error if iCalendar output fails
pub fn serialize_with_selector(
    tree: &ComponentNode,
    request: Option<&CalendarDataRequest>,
) -> anyhow::Result<String> {
    let mut output = String::new();
    
    // Default: include all if no request specified
    if request.is_none() {
        return serialize_component_full(tree);
    }
    
    let req = request.unwrap();
    serialize_component_selective(&mut output, tree, req)?;
    Ok(output)
}

fn serialize_component_selective(
    output: &mut String,
    node: &ComponentNode,
    request: &CalendarDataRequest,
) -> anyhow::Result<()> {
    // RFC 5545: BEGIN and END are mandatory
    output.push_str(&format!("BEGIN:{}\r\n", node.name));
    
    // Add RFC-required properties if at top level
    if node.name == "VCALENDAR" {
        // RFC 5545 §3.6: VCALENDAR MUST have VERSION and PRODID
        if let Some(version_prop) = find_property(node, "VERSION") {
            serialize_property(output, version_prop)?;
        } else {
            output.push_str("VERSION:2.0\r\n");  // Default
        }
        
        if let Some(prodid_prop) = find_property(node, "PRODID") {
            serialize_property(output, prodid_prop)?;
        } else {
            output.push_str("PRODID:-//Shuriken//CalDAV Server//EN\r\n");
        }
    }
    
    // Add RFC-required properties for VEVENT/VTODO
    if matches!(node.name.as_str(), "VEVENT" | "VTODO" | "VJOURNAL") {
        // UID and DTSTAMP are required
        if let Some(uid_prop) = find_property(node, "UID") {
            serialize_property(output, uid_prop)?;
        }
        if let Some(dtstamp_prop) = find_property(node, "DTSTAMP") {
            serialize_property(output, dtstamp_prop)?;
        }
    }
    
    // Serialize properties according to request
    if request.include_all_properties {
        // Include all properties
        for property in &node.properties {
            if !is_required_calendar_property(&property.name) {
                serialize_property(output, property)?;
            }
        }
    } else if !request.requested_properties.is_empty() {
        // Include only requested properties
        for prop_name in &request.requested_properties {
            if let Some(prop) = find_property(node, prop_name) {
                serialize_property(output, prop)?;
            }
        }
    }
    
    // Serialize components according to request
    if request.include_all_components {
        // Recursively serialize all child components
        for child in &node.children {
            serialize_component_selective(output, child, request)?;
        }
    } else if !request.requested_components.is_empty() {
        // Serialize only requested child component types
        for child in &node.children {
            if request.requested_components.contains(&child.name.as_str()) {
                serialize_component_selective(output, child, request)?;
            }
        }
    } else if node.name == "VCALENDAR" {
        // For VCALENDAR with no component request, include VTIMEZONE by default
        for child in &node.children {
            if child.name == "VTIMEZONE" {
                serialize_component_selective(output, child, request)?;
            }
        }
    }
    
    output.push_str(&format!("END:{}\r\n", node.name));
    Ok(())
}

fn serialize_component_full(tree: &ComponentNode) -> anyhow::Result<String> {
    let mut output = String::new();
    output.push_str(&format!("BEGIN:{}\r\n", tree.name));
    
    for property in &tree.properties {
        serialize_property(&mut output, property)?;
    }
    
    for child in &tree.children {
        output.push_str(&serialize_component_full(child)?);
    }
    
    output.push_str(&format!("END:{}\r\n", tree.name));
    Ok(output)
}

fn serialize_property(output: &mut String, property: &Property) -> anyhow::Result<()> {
    // RFC 5545: Line folding at 75 octets
    let mut line = format!("{}:", property.name);
    
    // Add parameters
    for (param_name, param_value) in &property.parameters {
        line.push_str(&format!(";{}={}", param_name, param_value));
    }
    
    // Add value
    line.push(':');
    line.push_str(&escape_property_value(&property.value));
    
    // Fold lines at 75 octets
    fold_line(output, &line)?;
    Ok(())
}

fn fold_line(output: &mut String, line: &str) -> anyhow::Result<()> {
    const LINE_LENGTH: usize = 75;
    
    let bytes = line.as_bytes();
    let mut pos = 0;
    
    while pos < bytes.len() {
        let take = std::cmp::min(LINE_LENGTH, bytes.len() - pos);
        output.push_str(std::str::from_utf8(&bytes[pos..pos + take])?);
        output.push_str("\r\n");
        
        pos += take;
        if pos < bytes.len() {
            output.push(' ');  // Continuation line must start with space
        }
    }
    
    Ok(())
}

#[must_use]
fn is_required_calendar_property(name: &str) -> bool {
    matches!(name, "VERSION" | "PRODID" | "CALSCALE" | "UID" | "DTSTAMP")
}

fn find_property(node: &ComponentNode, name: &str) -> Option<&Property> {
    node.properties.iter().find(|p| p.name == name)
}

fn escape_property_value(value: &str) -> String {
    // RFC 5545: Escape special characters
    value
        .replace('\\', "\\\\")
        .replace(',', "\\,")
        .replace(';', "\\;")
        .replace('\n', "\\n")
}
```

#### Integration

```rust
// src/app/api/dav/method/report/calendar_query.rs

use crate::component::db::map::serialize_with_selector::serialize_with_selector;

async fn build_calendar_query_response(
    conn: &mut DbConnection<'_>,
    instances: Vec<DavInstance>,
    calendar_data_request: Option<&CalendarDataRequest>,
) -> anyhow::Result<Multistatus> {
    let mut responses = Vec::new();
    
    for instance in instances {
        // Load component tree
        let tree = load_component_tree(conn, instance.entity_id).await?;
        
        // Serialize with selector
        let ical_data = serialize_with_selector(&tree, calendar_data_request)?;
        
        responses.push(DavResponse {
            href: instance.href(),
            status: StatusCode::OK,
            properties: vec![
                Property::calendar_data(ical_data),
            ],
        });
    }
    
    Ok(Multistatus { responses })
}
```

#### Testing

```rust
#[test]
fn test_selective_serialization_only_summary() {
    let tree = create_test_event_tree();
    
    let request = CalendarDataRequest {
        include_all_properties: false,
        requested_properties: vec!["SUMMARY".to_string()],
        include_all_components: false,
        requested_components: vec![],
    };
    
    let ical = serialize_with_selector(&tree, Some(&request)).unwrap();
    
    // Should include SUMMARY
    assert!(ical.contains("SUMMARY:Test Event"));
    
    // Should NOT include DESCRIPTION
    assert!(!ical.contains("DESCRIPTION"));
    
    // Should still include required properties
    assert!(ical.contains("VERSION:2.0"));
    assert!(ical.contains("UID:"));
}

#[test]
fn test_selective_serialization_without_valarm() {
    let tree = create_event_with_alarm();
    
    let request = CalendarDataRequest {
        include_all_properties: true,
        requested_properties: vec![],
        include_all_components: false,
        requested_components: vec!["VEVENT".to_string()],  // No VALARM
    };
    
    let ical = serialize_with_selector(&tree, Some(&request)).unwrap();
    
    assert!(ical.contains("BEGIN:VEVENT"));
    assert!(!ical.contains("BEGIN:VALARM"));
}
```

---

## Testing Strategy {#testing-strategy}

### Unit Tests

**Location**: Within each pattern's source file (`#[cfg(test)]` module)

**Coverage**:
- Property generator output format
- Error XML structure validation
- Collation matching logic
- Token parsing and validation
- Selective serialization logic

**Example**:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_report_set_contains_calendar_query() {
        let xml = DiscoveryProperties::supported_report_set_caldav();
        assert!(xml.contains("calendar-query"));
        assert!(xml.contains("xmlns:C=\"urn:ietf:params:xml:ns:caldav\""));
    }
}
```

### Integration Tests

**Location**: `tests/integration/`

**Coverage**:
- End-to-end PROPFIND with live properties
- PUT with precondition errors
- Authorization failures with need-privileges
- calendar-query with filters and collations
- sync-collection with token validation

**Test Utilities**:
```rust
// tests/integration/helpers.rs

pub async fn setup_test_db() -> TestDatabase {
    // Create temp database, run migrations
}

pub async fn create_test_user(db: &TestDatabase) -> User {
    // Insert user, return model
}

pub async fn create_test_calendar(db: &TestDatabase, user: &User) -> Collection {
    // Create calendar collection
}

pub fn build_propfind_request(path: &str, properties: &[&str]) -> Request {
    // Construct PROPFIND XML body
}

pub async fn execute_request(req: Request) -> Response {
    // Run through Salvo service
}
```

**Example Integration Test**:
```rust
#[test_log::test(tokio::test)]
async fn propfind_on_calendar_returns_supported_report_set() {
    let db = setup_test_db().await;
    let user = create_test_user(&db).await;
    let calendar = create_test_calendar(&db, &user).await;
    
    let req = build_propfind_request(
        &calendar.path,
        &["DAV:supported-report-set"]
    );
    
    let res = execute_request(req).await;
    
    assert_eq!(res.status(), 207);
    
    let body = res.text().await;
    assert!(body.contains("calendar-query"));
    assert!(body.contains("calendar-multiget"));
}
```

### Conformance Tests

**Tool**: CalDAV Tester (https://github.com/apple/ccs-caldavtester)

**Test Suites**:
- CalDAV compliance (RFC 4791)
- CardDAV compliance (RFC 6352)
- WebDAV ACL (RFC 3744)
- Collection Sync (RFC 6578)

**Run Command**:
```bash
./testcaldav.py --server localhost:3000 \
                --user test@example.com \
                --pswd password \
                --print-details-onfail \
                tests/CalDAV/reports.xml
```

---

## Deployment Checklist {#deployment-checklist}

### Pre-Deployment

- [ ] All unit tests passing (`cargo test --lib`)
- [ ] All integration tests passing (`cargo test --test '*'`)
- [ ] CalDAV Tester validation completed
- [ ] Code review approved by 2+ reviewers
- [ ] Performance benchmarks show no regression
- [ ] Database migrations tested on staging
- [ ] Rollback plan documented

### Phase 0 Deployment (P0 - Critical)

- [ ] Remove LOCK/UNLOCK from DAV header
- [ ] Add `supported-report-set` property to PROPFIND
- [ ] Verify with `curl -X OPTIONS` response
- [ ] Test with Apple Calendar and Thunderbird
- [ ] Monitor error logs for 30 minutes
- [ ] Rollback if issues detected

### Phase 1 Deployment (P1 - Core Compliance)

- [ ] Deploy property generators
- [ ] Deploy error XML builders
- [ ] Deploy ACL serialization
- [ ] Deploy need-privileges error handling
- [ ] Run CalDAV Tester full suite
- [ ] Monitor 403/409 status code rates
- [ ] Track client sync success rates
- [ ] Rollback window: 4 hours

### Phase 2 Deployment (P2 - Enhanced)

- [ ] Deploy filter validation
- [ ] Deploy text-match collation
- [ ] Deploy sync-token validation
- [ ] Deploy selective serialization
- [ ] Run calendar-query performance tests
- [ ] Monitor query response times
- [ ] Track sync-collection error rates
- [ ] Rollback window: 8 hours

### Phase 3 Deployment (P3 - Advanced)

- [ ] Deploy timezone enhancements
- [ ] Deploy recurrence optimization
- [ ] Deploy free/busy aggregation
- [ ] Full conformance test suite
- [ ] Load testing with 1000+ concurrent clients
- [ ] Monitor resource usage
- [ ] Rollback window: 24 hours

### Post-Deployment Monitoring

**Metrics to Watch**:
- HTTP status code distribution (200, 207, 403, 409, 412)
- PROPFIND response times
- calendar-query execution times
- sync-collection request rates
- Error log volume
- Client sync failure rates

**Alert Thresholds**:
- 403 rate increase > 20%
- 409 rate increase > 30%
- PROPFIND p99 latency > 500ms
- calendar-query p99 latency > 2s
- Error log rate > 10/min

---

## Rollout Plan {#rollout-plan}

### Timeline

| Phase | Duration | Focus | Risk Level |
|-------|----------|-------|------------|
| P0 | 1 hour | Critical fixes | Low |
| P1 | 1 week | Core compliance | Medium |
| P2 | 1 week | Enhanced features | Medium |
| P3 | 2 weeks | Advanced features | High |

### Phase 0: Immediate Fixes (1 Hour)

**Changes**:
1. Remove LOCK/UNLOCK methods from OPTIONS
2. Add basic supported-report-set property

**Deployment**:
- Deploy during low-traffic window
- Monitor for 30 minutes
- Rollback if any errors

**Success Criteria**:
- OPTIONS header correct
- No increase in error rates
- Apple Calendar connects successfully

### Phase 1: Core Compliance (Week 1)

**Day 1-2**: Property Generators
- Deploy live property generation
- Test with multiple clients
- Monitor PROPFIND performance

**Day 3-4**: Error Responses
- Deploy precondition errors
- Test PUT validation
- Monitor 409 error rates

**Day 5**: ACL Serialization
- Deploy ACL property generation
- Test authorization checks
- Monitor 403 error rates

**Day 6-7**: Stabilization
- Bug fixes
- Performance tuning
- Documentation

### Phase 2: Enhanced Features (Week 2)

**Day 1-2**: Filter Validation
- Deploy filter capability registry
- Test calendar-query
- Monitor query performance

**Day 3-4**: Collation & Sync
- Deploy text-match collation
- Deploy sync-token validation
- Test with various clients

**Day 5**: Selective Serialization
- Deploy partial retrieval
- Test calendar-data requests
- Monitor serialization performance

**Day 6-7**: Stabilization

### Phase 3: Advanced Features (Weeks 3-4)

- Incremental feature deployment
- Comprehensive testing
- Performance optimization
- Full documentation

---

## Conclusion {#conclusion}

This guide provides everything needed to implement RFC compliance in Shuriken:

1. **8 Proven Patterns** - Copy-paste ready code examples
2. **Clear Phases** - Organized by priority and risk
3. **Complete Tests** - Unit, integration, and conformance
4. **Deployment Plan** - Step-by-step rollout with monitoring
5. **Rollback Strategy** - Safety at every phase

**Next Steps**:
1. Start with Phase 0 (1 hour investment)
2. Validate with CalDAV Tester
3. Proceed to Phase 1 (week-long sprint)
4. Iterate based on real-world usage

**Questions or Issues?**
- Refer to RFC citations for specification details
- Check test examples for expected behavior
- Review integration points for context

---

**Document Version**: 2.0  
**Last Updated**: 2026-01-29  
**Maintained By**: Shuriken Development Team
