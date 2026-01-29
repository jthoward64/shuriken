# 1. Protocol Overview

## 1.1 CalDAV (RFC 4791)

CalDAV extends WebDAV to provide calendar access. Core concepts:

| Concept | Description |
|---------|-------------|
| **Calendar Collection** | WebDAV collection containing calendar object resources; `DAV:resourcetype` includes `DAV:collection` and `CALDAV:calendar` |
| **Calendar Object Resource** | Individual `.ics` file containing one iCalendar object (one UID, possibly with recurrence overrides) |
| **Principal** | Identity for ACL; users access calendars via `CALDAV:calendar-home-set` |
| **Scheduling** | RFC 6638 defines implicit scheduling via `schedule-inbox` and `schedule-outbox` collections |

**Required Capabilities** (RFC 4791 §2):
- MUST support iCalendar (RFC 5545) as a media type
- MUST support WebDAV Class 1 (RFC 4918)
- MUST support WebDAV ACL (RFC 3744)
- MUST support transport over TLS (HTTPS/TLS)
- MUST support ETags with strong validators
- MUST advertise report support via the `DAV:supported-report-set` property (RFC 3253)
- MUST support all calendaring reports (`calendar-query`, `calendar-multiget`, `free-busy-query`)
- MKCALENDAR method (SHOULD support)

## 1.2 CardDAV (RFC 6352)

CardDAV extends WebDAV for address book access. Core concepts:

| Concept | Description |
|---------|-------------|
| **Address Book Collection** | WebDAV collection containing address object resources; `DAV:resourcetype` includes `DAV:collection` and `CARDDAV:addressbook` |
| **Address Object Resource** | Individual `.vcf` file containing exactly one vCard |
| **Principal** | Identity for ACL; users access addressbooks via `CARDDAV:addressbook-home-set` |
| **Principal Address** | Optional vCard resource representing the principal (`CARDDAV:principal-address`) |

**Required Capabilities** (RFC 6352 §3):
- MUST support vCard v3 (RFC 2426) as a media type; SHOULD support vCard v4 (RFC 6350)
- MUST support WebDAV Class 3 (RFC 4918)
- MUST support WebDAV ACL (RFC 3744)
- MUST support secure transport (HTTPS/TLS)
- MUST support ETags with strong validators
- MUST advertise report support via the `DAV:supported-report-set` property (RFC 3253)
- MUST support all addressbook reports (`addressbook-query`, `addressbook-multiget`)
- MUST support the `DAV:expand-property` report (RFC 3253 §3.8)

**Recommended Capabilities**:
- Extended MKCOL (RFC 5689) for creating address book collections
- `DAV:current-user-principal` (RFC 5397; RFC 6352 refers to this as `DAV:current-user-principal-URL`) for principal discovery

### 1.2.1 Address Book Collection Constraints

| Constraint | Description |
|------------|-------------|
| Single vCard per resource | Each address object resource contains exactly ONE vCard |
| UID uniqueness | UID MUST be unique within the address book collection |
| No nested address books | Address book collections MUST NOT contain other address books at any depth |
| Allowed child types | Address book collections MUST only contain address object resources and collections that are not address book collections |
| Sub-collections allowed | Non-addressbook collections MAY exist but MUST NOT contain address books |

### 1.2.2 CardDAV Collection Properties

| Property | Protected | Description |
|----------|-----------|-------------|
| `CARDDAV:addressbook-description` | No | Human-readable collection description |
| `CARDDAV:supported-address-data` | Yes | Supported vCard media types/versions |
| `CARDDAV:max-resource-size` | Yes | Maximum size in octets for address objects |
| `CARDDAV:supported-collation-set` | Yes | Supported text collations for queries |

**supported-address-data Example**:
```xml
<C:supported-address-data xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:address-data-type content-type="text/vcard" version="3.0"/>
  <C:address-data-type content-type="text/vcard" version="4.0"/>
</C:supported-address-data>
```

### 1.2.3 CardDAV Principal Properties

| Property | Description |
|----------|-------------|
| `CARDDAV:addressbook-home-set` | URL(s) of collections containing user's address books |
| `CARDDAV:principal-address` | URL of vCard representing the principal |

**addressbook-home-set Example**:
```xml
<C:addressbook-home-set xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:href>/addressbooks/user/</D:href>
</C:addressbook-home-set>
```

### 1.2.4 CardDAV Preconditions for PUT/COPY/MOVE

| Precondition | Triggered When |
|--------------|----------------|
| `CARDDAV:supported-address-data` | Unsupported media type |
| `CARDDAV:valid-address-data` | Invalid vCard syntax |
| `CARDDAV:no-uid-conflict` | UID already exists in collection (or UID changed on update) |
| `CARDDAV:addressbook-collection-location-ok` | Destination doesn't allow address book creation |
| `CARDDAV:max-resource-size` | Resource exceeds size limit |

**no-uid-conflict Response**:
```xml
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:no-uid-conflict>
    <D:href>/addressbooks/user/contacts/existing.vcf</D:href>
  </C:no-uid-conflict>
</D:error>
```

## 1.3 XML Namespaces

| Prefix | Namespace URI |
|--------|---------------|
| `DAV:` | `DAV:` |
| `CALDAV:` | `urn:ietf:params:xml:ns:caldav` |
| `CARDDAV:` | `urn:ietf:params:xml:ns:carddav` |
| `CS:` | `http://calendarserver.org/ns/` (Apple extensions) |

---
