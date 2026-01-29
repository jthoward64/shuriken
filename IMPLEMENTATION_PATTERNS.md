# Shuriken RFC Compliance - Implementation Patterns

**Purpose**: Concrete code examples for implementing RFC compliance fixes  
**Status**: Reference implementation patterns (adapt to Shuriken's architecture)

---

## Pattern 1: Live Property Generators ✅ IMPLEMENTED

**Status**: Implemented and merged (2026-01-29)  
**Location**: `src/component/rfc/dav/core/property/discovery.rs`  
**Integration**: `src/app/api/dav/method/propfind/helpers.rs`  
**RFC**: RFC 4791 §5.2.3, §7.5.1; RFC 6352 §6.2.2; RFC 3253 §3.1.5  
**Tests**: 7 unit tests + 5 integration tests (unit tests passing, integration tests written)

### Discovery Properties (supported-report-set, supported-components)

```rust
// src/component/rfc/properties/discovery.rs

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
    pub fn max_resource_size(size_bytes: u64) -> String {
        format!(
            "<C:max-resource-size xmlns:C=\"urn:ietf:params:xml:ns:caldav\">{}</C:max-resource-size>",
            size_bytes
        )
    }
}
```

### Integration into PROPFIND Response

```rust
// In propfind handler
use crate::component::rfc::properties::discovery::*;

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
    
    Ok(props)
}
```

---

## Pattern 2: Precondition Error XML Builders

### CalDAV Error Elements (RFC 4791 §1.3)

```rust
// src/component/rfc/errors/caldav.rs

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
            reason
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
            content_type
        )
    }

    /// RFC 4791 §5.3.2.1: UID conflict
    /// Status: 409 Conflict when UID already exists in collection
    pub fn uid_conflict(uid: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                <C:no-uid-conflict>
                    <D:description>UID {} already exists in collection</D:description>
                </C:no-uid-conflict>
            </D:error>
            "#,
            uid
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
}
```

### Integration into PUT Handler

```rust
// In put handler for calendar resources
use crate::component::rfc::errors::caldav::CalDAVErrors;

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
    if collection.has_uid(&ical.uid).await? {
        return Err((
            StatusCode::CONFLICT,
            CalDAVErrors::uid_conflict(&ical.uid),
        ));
    }

    // ... rest of PUT logic ...
    Ok(StatusCode::CREATED)
}
```

---

## Pattern 3: CardDAV Error Elements (RFC 6352 §6.3.2.1)

```rust
// src/component/rfc/errors/carddav.rs

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
            reason
        )
    }

    /// RFC 6352 §6.3.2.1: UID conflict
    pub fn uid_conflict(uid: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
                <CR:no-uid-conflict>
                    <D:description>UID {} already exists in this addressbook</D:description>
                </CR:no-uid-conflict>
            </D:error>
            "#,
            uid
        )
    }

    /// RFC 6352 §5.1.1: Media type conversion error
    pub fn unsupported_address_data_conversion(from: &str, to: &str) -> String {
        format!(
            r#"
            <D:error xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
                <CR:supported-address-data-conversion>
                    <D:description>Cannot convert from {} to {}</D:description>
                </CR:supported-address-data-conversion>
            </D:error>
            "#,
            from, to
        )
    }
}
```

---

## Pattern 4: ACL Property Serialization

### Convert Casbin Policies to DAV:acl XML

```rust
// src/component/rfc/properties/acl.rs

use crate::component::auth::enforcer::*;

pub struct ACLSerializer;

impl ACLSerializer {
    /// RFC 3744 §5.5: Generate DAV:acl property from Casbin policies
    pub async fn serialize_acl(
        resource_path: &str,
        enforcer: &CasbinEnforcer,
    ) -> Result<String, Error> {
        // Get all policies matching this resource
        let policies = enforcer.get_policies_for_resource(resource_path).await?;
        
        let aces = policies
            .iter()
            .map(|policy| {
                let principal_xml = Self::serialize_principal(&policy.subject);
                let privileges_xml = Self::serialize_privileges(&policy.action);
                
                format!(
                    r#"
                    <D:ace>
                        {}
                        <D:grant>
                            {}
                        </D:grant>
                    </D:ace>
                    "#,
                    principal_xml, privileges_xml
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        Ok(format!(
            r#"
            <D:acl xmlns:D="DAV:">
                {}
            </D:acl>
            "#,
            aces
        ))
    }

    fn serialize_principal(subject: &str) -> String {
        // Map Casbin subject (user UUID, group UUID, "public") to RFC principal
        if subject == "public" {
            "<D:principal><D:authenticated/></D:principal>".to_string()
        } else if subject.starts_with("group:") {
            let group_uuid = &subject[6..];
            format!(
                "<D:principal><D:href>/principals/groups/{}</D:href></D:principal>",
                group_uuid
            )
        } else {
            // Assume it's a user UUID
            format!(
                "<D:principal><D:href>/principals/users/{}</D:href></D:principal>",
                subject
            )
        }
    }

    fn serialize_privileges(action: &str) -> String {
        // Map Casbin action to RFC privileges
        match action {
            "read" => "<D:privilege><D:read/></D:privilege>".to_string(),
            "write" => "<D:privilege><D:write/></D:privilege>".to_string(),
            "admin" => "<D:privilege><D:all/></D:privilege>".to_string(),
            _ => "<D:privilege><D:read/></D:privilege>".to_string(),
        }
    }
}
```

### Integration into PROPFIND

```rust
// In propfind handler - add ACL property
if requested_props.contains(&"DAV:acl".to_string()) 
    || requested_props.is_empty() {
    let acl_xml = ACLSerializer::serialize_acl(
        resource_path,
        &enforcer
    ).await?;
    
    props.insert("DAV:acl".to_string(), acl_xml);
}
```

---

## Pattern 5: Need-Privileges Error Element (RFC 3744 §7.1.1)

### Build 403 Error with Missing Privileges

```rust
// src/component/rfc/errors/acl.rs

pub struct ACLErrors;

impl ACLErrors {
    /// RFC 3744 §7.1.1: Report missing privileges on 403 Forbidden
    pub fn need_privileges(resource_path: &str, missing_privileges: &[&str]) -> String {
        let resources = missing_privileges
            .iter()
            .map(|priv_name| {
                let privilege = match *priv_name {
                    "read" => "<D:privilege><D:read/></D:privilege>",
                    "write" => "<D:privilege><D:write/></D:privilege>",
                    "write-acl" => "<D:privilege><D:write-acl/></D:privilege>",
                    "read-acl" => "<D:privilege><D:read-acl/></D:privilege>",
                    _ => "<D:privilege><D:read/></D:privilege>",
                };
                
                format!(
                    r#"
                    <D:resource>
                        <D:href>{}</D:href>
                        {}
                    </D:resource>
                    "#,
                    resource_path, privilege
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!(
            r#"
            <D:error xmlns:D="DAV:">
                <D:need-privileges>
                    {}
                </D:need-privileges>
            </D:error>
            "#,
            resources
        )
    }
}
```

### Integration into Authorization Check

```rust
// In authorization handler
async fn check_privilege(
    resource_path: &str,
    privilege: &str,
    enforcer: &CasbinEnforcer,
    user: &User,
) -> Result<(), (StatusCode, String)> {
    if !enforcer.enforce(&user.id, resource_path, privilege).await? {
        let error_xml = ACLErrors::need_privileges(
            resource_path,
            &[privilege],
        );
        
        return Err((
            StatusCode::FORBIDDEN,
            error_xml,
        ));
    }
    
    Ok(())
}
```

---

## Pattern 6: Text-Match Collation Integration

### Apply RFC 4790 i;unicode-casemap Collation

```rust
// src/component/rfc/filters/collation.rs

use icu::casemap::CaseMapper;

pub struct CollationFilter;

impl CollationFilter {
    /// RFC 4790: Implement i;unicode-casemap collation
    /// Maps string to lowercase using Unicode case folding rules
    pub fn unicode_casemap_normalize(s: &str) -> Result<String, Error> {
        let mapper = CaseMapper::new();
        
        // Use ICU's case folding (best for collation)
        let folded = mapper.fold_string(s);
        
        Ok(folded)
    }

    /// Apply collation to text-match filter
    pub fn matches(
        text: &str,
        pattern: &str,
        collation: &str,
        match_type: &str,
    ) -> Result<bool, Error> {
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
            _ => (text.to_string(), pattern.to_string()),
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

### Integration into Filter Evaluation

```rust
// In calendar-query REPORT handler
fn evaluate_text_match_filter(
    component: &Component,
    filter: &TextMatch,
) -> Result<bool, Error> {
    let text = component.get_property_value(&filter.property)?;
    
    CollationFilter::matches(
        &text,
        &filter.pattern,
        &filter.collation,     // "i;unicode-casemap"
        &filter.match_type,    // "contains", "starts-with", etc.
    )
}
```

---

## Pattern 7: Sync-Token Retention Validation

### Check Token Age Against Retention Window

```rust
// src/component/rfc/validation/sync.rs

use chrono::{DateTime, Utc, Duration};

pub struct SyncTokenValidator;

impl SyncTokenValidator {
    /// RFC 6578 §4.1: Validate sync-token is within retention window
    /// Minimum retention: 1 week per RFC 6578
    pub fn validate_sync_token(
        sync_token: &str,
        collection_id: &Uuid,
        db: &DbConnection,
    ) -> Result<(), SyncTokenError> {
        // Parse token (e.g., "1234567-5678")
        let (revision, timestamp) = Self::parse_token(sync_token)?;
        
        // Get current sync state
        let current = db.get_collection_sync_state(collection_id)?;
        
        // Check token is recent enough (7 days minimum)
        let token_age = Utc::now() - timestamp;
        if token_age > Duration::days(7) {
            // Token too old - retention window expired
            return Err(SyncTokenError::ValidSyncTokenPrecondition);
        }
        
        Ok(())
    }

    fn parse_token(token: &str) -> Result<(i64, DateTime<Utc>), SyncTokenError> {
        // Token format: revision-timestamp (RFC 6578 defines opaque token)
        // Shuriken: "1234567-1704067200" (revision-unix_timestamp)
        let parts: Vec<&str> = token.split('-').collect();
        
        if parts.len() != 2 {
            return Err(SyncTokenError::InvalidToken);
        }
        
        let revision: i64 = parts[0].parse()?;
        let timestamp_secs: i64 = parts[1].parse()?;
        let timestamp = DateTime::<Utc>::from_timestamp(timestamp_secs, 0)?;
        
        Ok((revision, timestamp))
    }
}

pub enum SyncTokenError {
    InvalidToken,
    ValidSyncTokenPrecondition,  // Return as precondition error
}
```

### Precondition Response

```rust
// Return in sync-collection REPORT if token too old
let error_xml = format!(
    r#"
    <D:error xmlns:D="DAV:" xmlns:S="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <S:valid-sync-token/>
    </D:error>
    "#
);

return Err((StatusCode::PRECONDITION_FAILED, error_xml));
```

---

## Pattern 8: Selective Calendar-Data Serialization

### Reconstruct Calendar with Filtered Components

```rust
// src/component/rfc/serialization/selective.rs

pub struct SelectiveSerializer;

impl SelectiveSerializer {
    /// RFC 4791 §9.6: Return only specified components
    /// Example filter: ["VEVENT", "VEVENT/VALARM"]
    pub fn serialize_with_filter(
        entity: &Entity,
        component_paths: &[&str],
    ) -> String {
        let mut ical = String::from("BEGIN:VCALENDAR\r\n");
        ical.push_str("VERSION:2.0\r\n");
        ical.push_str("PRODID:-//Shuriken//CalDAV//EN\r\n");

        // Walk component tree, include only matching paths
        for component in &entity.components {
            if Self::should_include("VEVENT", component_paths) {
                ical.push_str(&Self::serialize_component(&component, 0));
            } else if Self::should_include("VTODO", component_paths) {
                ical.push_str(&Self::serialize_component(&component, 0));
            }
            // ... other component types
        }

        ical.push_str("END:VCALENDAR\r\n");
        ical
    }

    fn should_include(component_type: &str, paths: &[&str]) -> bool {
        // Check if this component type appears in filter list
        paths.iter().any(|p| p.starts_with(component_type))
    }

    fn serialize_component(component: &Component, depth: usize) -> String {
        let mut out = String::new();
        out.push_str(&format!("BEGIN:{}\r\n", component.kind));
        
        // Serialize properties
        for property in &component.properties {
            out.push_str(&property.to_ical_line());
        }
        
        // Serialize nested components
        for child in &component.children {
            out.push_str(&Self::serialize_component(child, depth + 1));
        }
        
        out.push_str(&format!("END:{}\r\n", component.kind));
        out
    }
}
```

---

## Deployment Checklist

### Before Deploying These Changes

- [ ] Add `i;unicode-casemap` to test suite (RFC 4790)
- [ ] Add precondition error tests (RFC 4791/6352)
- [ ] Test property generation in PROPFIND (live properties)
- [ ] Verify sync-token validation (RFC 6578)
- [ ] Test selective serialization (component filtering)
- [ ] Remove LOCK/UNLOCK from DAV header (RFC 4918)
- [ ] Add principal URL discovery `/principals/` endpoint
- [ ] Test ACL serialization (Casbin → XML)
- [ ] Verify `DAV:need-privileges` in 403 responses

### Rollout Plan

1. **Phase 0 (1 hour)**: Remove LOCK/UNLOCK, add `supported-report-set`
2. **Phase 1 (1 week)**: Add property generators + error XML
3. **Phase 2 (1 week)**: Add ACL serializer, need-privileges
4. **Phase 3 (2 weeks)**: Query improvements, validation

---

**Implementation Patterns Document**  
**Version**: 1.0  
**Status**: Reference implementation examples (adapt to Shuriken code style)
