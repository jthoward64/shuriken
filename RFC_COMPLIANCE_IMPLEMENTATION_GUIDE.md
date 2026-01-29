# RFC Compliance Implementation Guide

**Purpose**: Concrete code patterns for implementing RFC compliance fixes  
**Status**: Reference guide for developers

---

## Part 1: Property Discovery Implementation

### Pattern 1.1: Adding Computed Live Properties

**File**: [src/component/rfc/dav/core/property.rs](src/component/rfc/dav/core/property.rs)

```rust
/// Generate supported-report-set property for a collection
pub fn supported_report_set(collection_type: CollectionType) -> String {
    match collection_type {
        CollectionType::Calendar => {
            // RFC 4791 §2: calendar-access servers MUST support these
            r#"<?xml version="1.0" encoding="utf-8"?>
<D:supported-report-set xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:supported-report>
    <D:report><C:calendar-query/></D:report>
  </D:supported-report>
  <D:supported-report>
    <D:report><C:calendar-multiget/></D:report>
  </D:supported-report>
  <D:supported-report>
    <D:report><C:sync-collection/></D:report>
  </D:supported-report>
</D:supported-report-set>"#.into()
        },
        CollectionType::Addressbook => {
            // RFC 6352 §3: addressbook servers MUST support these
            r#"<?xml version="1.0" encoding="utf-8"?>
<D:supported-report-set xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <D:supported-report>
    <D:report><CR:addressbook-query/></D:report>
  </D:supported-report>
  <D:supported-report>
    <D:report><CR:addressbook-multiget/></D:report>
  </D:supported-report>
  <D:supported-report>
    <D:report><D:sync-collection/></D:report>
  </D:supported-report>
</D:supported-report-set>"#.into()
        },
    }
}

/// Generate supported-calendar-component-set property
pub fn supported_calendar_component_set() -> String {
    // RFC 4791 §5.2.3: Must advertise what component types are supported
    r#"<?xml version="1.0" encoding="utf-8"?>
<C:supported-calendar-component-set xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:comp name="VEVENT"/>
  <C:comp name="VTODO"/>
  <C:comp name="VJOURNAL"/>
</C:supported-calendar-component-set>"#.into()
}

/// Generate supported-address-data property
pub fn supported_address_data() -> String {
    // RFC 6352 §6.2.2: Advertise supported vCard versions
    r#"<?xml version="1.0" encoding="utf-8"?>
<CR:supported-address-data xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <CR:address-data-type content-type="text/vcard" version="3.0"/>
  <CR:address-data-type content-type="text/vcard" version="4.0"/>
</CR:supported-address-data>"#.into()
}

/// Generate supported-collation-set property
pub fn supported_collation_set() -> String {
    // RFC 4791 §7.5.1: List supported text matching collations
    r#"<?xml version="1.0" encoding="utf-8"?>
<C:supported-collation-set xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:supported-collation>i;octet</C:supported-collation>
  <C:supported-collation>i;ascii-casemap</C:supported-collation>
  <C:supported-collation>i;unicode-casemap</C:supported-collation>
</C:supported-collation-set>"#.into()
}
```

**Integration Point**: [src/app/api/dav/handler/propfind.rs](src/app/api/dav/handler/propfind.rs)

```rust
// In PROPFIND response generation, add to live properties:

if qname.namespace_uri() == "DAV:" && qname.local_name() == "supported-report-set" {
    properties.push(DavProperty::xml(
        qname,
        supported_report_set(collection.collection_type),
    ));
    continue;
}

if qname.namespace_uri() == "urn:ietf:params:xml:ns:caldav" && qname.local_name() == "supported-calendar-component-set" {
    properties.push(DavProperty::xml(qname, supported_calendar_component_set()));
    continue;
}

// Similar for other properties...
```

---

## Part 2: Error Response Implementation

### Pattern 2.1: need-privileges Error Generation

**File**: [src/component/rfc/dav/core/error.rs](src/component/rfc/dav/core/error.rs)

```rust
use crate::component::rfc::dav::core::Href;

/// Represents a required privilege that was denied
#[derive(Debug, Clone)]
pub struct PrivilegeRequired {
    pub href: Href,
    pub privilege: String,
}

/// Generate need-privileges error XML
pub fn need_privileges_error(privileges_required: &[PrivilegeRequired]) -> String {
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

/// Generate supported-filter error XML  (RFC 4791 §7.7)
pub fn supported_filter_error(unsupported_filters: &[String]) -> String {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:supported-filter>"#
    );

    for filter in unsupported_filters {
        xml.push_str(&format!(
            r#"
    <C:prop-filter name="{}"/>"#,
            filter
        ));
    }

    xml.push_str(
        r#"
  </C:supported-filter>
</D:error>"#
    );
    xml
}
```

**Usage in Authorization Check**:

```rust
// File: src/app/api/dav/method/get_head/handlers.rs

async fn check_read_authorization(
    depot: &salvo::Depot,
    conn: &mut DbConnection<'_>,
    instance: &DavInstance,
    resource_href: &str,  // ← Client-visible path
) -> Result<(), AppError> {
    let subjects = get_subjects_from_depot(depot, conn).await?;
    
    // Check authorization...
    if !can_read(&subjects, collection_id) {
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

// In error handler:
AppError::ForbiddenWithPrivileges { errors } => {
    res.set_status(StatusCode::FORBIDDEN);
    res.set_content_type(ContentType::xml());
    res.write_body(need_privileges_error(&errors));
}
```

---

### Pattern 2.2: Calendar-Data Precondition Errors

**File**: [src/component/caldav/service/object.rs](src/component/caldav/service/object.rs)

```rust
/// Generate error XML for PUT failures
pub fn put_precondition_error(error_type: PutError) -> String {
    match error_type {
        PutError::UidConflict { uid, existing_uri } => {
            // RFC 4791 §5.3.2.1
            format!(
                r#"<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:no-uid-conflict>
    <D:href>{}</D:href>
  </C:no-uid-conflict>
</D:error>"#,
                existing_uri
            )
        },
        PutError::InvalidCalendarData { reason } => {
            // RFC 4791 §5.3.2.1
            format!(
                r#"<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:valid-calendar-data/>
  <D:error-description>{}</D:error-description>
</D:error>"#,
                xml_escape(&reason)
            )
        },
        PutError::UnsupportedComponent { component } => {
            // RFC 4791 §5.3.2.1
            format!(
                r#"<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:supported-calendar-component>
    <C:comp name="{}"/>
  </C:supported-calendar-component>
</D:error>"#,
                component
            )
        },
        PutError::UnsupportedMediaType => {
            // RFC 4791 §5.3.2.1
            r#"<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:supported-calendar-data/>
</D:error>"#.to_string()
        },
    }
}
```

---

## Part 3: Filter Validation Implementation

### Pattern 3.1: Filter Capability Registry

**File**: [src/component/caldav/service/filter_capabilities.rs](src/component/caldav/service/filter_capabilities.rs)

```rust
use std::collections::HashMap;

/// Defines what filters are supported by the server
#[derive(Debug, Clone)]
pub struct FilterCapabilities {
    /// Component filters: VCALENDAR → [VEVENT, VTODO, ...]
    pub comp_filters: HashMap<&'static str, Vec<&'static str>>,
    /// Property filters per component: VEVENT → [SUMMARY, DTSTART, ...]
    pub prop_filters: HashMap<&'static str, Vec<&'static str>>,
    /// Supported parameter names globally
    pub param_filters: Vec<&'static str>,
}

impl FilterCapabilities {
    /// Create default CalDAV filter capabilities (RFC 4791)
    #[must_use]
    pub fn calendar() -> Self {
        let mut comp_filters = HashMap::new();
        comp_filters.insert("VCALENDAR", vec!["VEVENT", "VTODO", "VJOURNAL", "VFREEBUSY", "VTIMEZONE"]);
        comp_filters.insert("VEVENT", vec![]);  // Terminal, no children
        comp_filters.insert("VTODO", vec![]);
        comp_filters.insert("VJOURNAL", vec![]);
        comp_filters.insert("VFREEBUSY", vec![]);
        
        let mut prop_filters = HashMap::new();
        // VEVENT properties that can be filtered (RFC 4791 §7.8.3)
        prop_filters.insert("VEVENT", vec![
            "DTSTART", "DTEND", "DURATION", "DTSTAMP",
            "UID", "SUMMARY", "STATUS", "RRULE", "RDATE", "EXDATE",
            "RECURRENCE-ID", "TRANSP", "LAST-MODIFIED", "ORGANIZER",
            "ATTENDEE", "CATEGORIES", "COMMENT", "DESCRIPTION",
            "LOCATION", "PRIORITY", "SEQUENCE", "CLASS",
        ]);
        prop_filters.insert("VTODO", vec![
            "DTSTART", "DUE", "DURATION", "DTSTAMP",
            "UID", "SUMMARY", "STATUS", "RRULE", "RDATE", "EXDATE",
            "RECURRENCE-ID", "COMPLETED", "PERCENT-COMPLETE",
        ]);
        
        Self {
            comp_filters,
            prop_filters,
            param_filters: vec!["TZID", "VALUE", "ROLE", "PARTSTAT"],
        }
    }
    
    /// Validate a filter against supported capabilities
    pub fn validate_filter(&self, filter: &CalendarFilter) -> Result<(), Vec<String>> {
        let mut unsupported = Vec::new();
        
        for comp_filter in &filter.comp_filters {
            if !self.validate_comp_filter(comp_filter, &mut unsupported) {
                // Already added to unsupported
            }
        }
        
        if unsupported.is_empty() {
            Ok(())
        } else {
            Err(unsupported)
        }
    }
    
    fn validate_comp_filter(&self, filter: &CompFilter, unsupported: &mut Vec<String>) -> bool {
        // Check if component is supported
        if !self.comp_filters.contains_key(filter.name.as_str()) {
            unsupported.push(format!("comp-filter/{}", filter.name));
            return false;
        }
        
        // Check nested filters
        for nested_comp in &filter.nested_comps {
            self.validate_comp_filter(nested_comp, unsupported);
        }
        
        for prop_filter in &filter.prop_filters {
            let supported_props = self.prop_filters.get(filter.name.as_str())
                .map(|props| props.as_slice())
                .unwrap_or(&[]);
                
            if !supported_props.contains(&prop_filter.name.as_str()) {
                unsupported.push(format!("prop-filter/{}", prop_filter.name));
            }
        }
        
        true
    }
}
```

**Usage in REPORT Handler**:

```rust
// File: src/component/caldav/handler/report.rs

pub async fn execute_calendar_query(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    query: &CalendarQuery,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    // Validate filter before executing  
    let capabilities = FilterCapabilities::calendar();
    
    if let Some(filter) = &query.filter {
        if let Err(unsupported) = capabilities.validate_filter(filter) {
            // Return 403 with supported-filter error
            return Err(FilterValidationError {
                unsupported_filters: unsupported,
            }.into());
        }
    }
    
    // Proceed with query execution
    find_matching_instances(conn, collection_id, query).await?;
    // ...
}
```

---

## Part 4: Selective Serialization Implementation

### Pattern 4.1: Component Tree Traversal with Selector

**File**: [src/component/db/map/serialize_with_selector.rs](src/component/db/map/serialize_with_selector.rs)

```rust
use crate::component::rfc::ical::core::{ComponentKind, Property};
use crate::component::rfc::dav::core::CalendarDataRequest;
use crate::component::model::dav::component::ComponentNode;

/// ## Summary
/// Serializes an iCalendar component tree with selective property/component inclusion.
///
/// Respects RFC 4791 §7.6 partial retrieval semantics:
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
        // For VCALENDAR with no component request, include VTIMEZONE
        for child in &node.children {
            if child.name == "VTIMEZONE" {
                serialize_component_selective(output, child, request)?;
            }
        }
    }
    
    output.push_str(&format!("END:{}\r\n", node.name));
    Ok(())
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

fn is_required_calendar_property(name: &str) -> bool {
    matches!(name, "VERSION" | "PRODID" | "CALSCALE")
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

---

## Part 5: ACL Property Generation

### Pattern 5.1: Converting Casbin Policies to DAV:acl XML

**File**: [src/component/auth/acl_properties.rs](src/component/auth/acl_properties.rs)

```rust
use crate::component::auth::casbin::CasbinEnforcer;
use crate::component::model::principal::Principal;

/// Generate DAV:acl property XML from Casbin policies
pub async fn acl_property_xml(
    enforcer: &CasbinEnforcer,
    resource_path: &str,
    is_inherited: bool,
) -> anyhow::Result<String> {
    // Get all policies for this resource
    let policies = enforcer.get_filtered_policy(1, &format!("{}*", resource_path));
    
    let mut xml = r#"<?xml version="1.0" encoding="utf-8"?>
<D:acl xmlns:D="DAV:">"#.to_string();
    
    for policy in policies {
        if policy.len() < 3 { continue; }
        
        let principal_id = &policy[0];
        let role = &policy[2];
        
        // Generate ACE element
        xml.push_str(&format!(
            r#"
  <D:ace>
    <D:principal>
      <D:href>/principals/users/{}</D:href>
    </D:principal>
    <D:grant>
      <D:privilege><D:{}/></D:privilege>
    </D:grant>"#,
            principal_id,
            privilege_for_role(role)
        ));
        
        if is_inherited {
            xml.push_str("\n    <D:inherited/>");
        }
        
        xml.push_str("\n  </D:ace>");
    }
    
    xml.push_str("\n</D:acl>");
    Ok(xml)
}

/// Map role to RFC privilege
fn privilege_for_role(role: &str) -> &'static str {
    match role {
        "read" => "read",
        "read-share" => "read",
        "edit" => "write",
        "edit-share" => "write",
        "admin" => "write",
        "owner" => "all",
        _ => "read",
    }
}

/// Privilege hierarchy for DAV:supported-privilege-set
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
```

---

## Appendix: Testing Patterns

### Test Pattern 1: Property Discovery

```rust
#[tokio::test]
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

### Test Pattern 2: Error Response

```rust
#[tokio::test]
async fn put_uid_conflict_returns_error_xml() {
    let test_db = setup_test_db().await;
    let collection = create_test_calendar(&test_db).await;
    
    // Create first event
    let ics1 = create_test_event_with_uid("uid-123");
    put_resource(&collection, "event1.ics", ics1).await;
    
    // Try to create second event with same UID
    let ics2 = create_test_event_with_uid("uid-123");
    let res = put_resource(&collection, "event2.ics", ics2).await;
    
    assert_eq!(res.status(), 409);  // Conflict
    
    let body = res.text().await;
    assert!(body.contains("no-uid-conflict"));
    assert!(body.contains("event1.ics"));  // Should reference existing resource
}
```

---

This guide provides concrete implementation patterns for all major RFC compliance fixes.

