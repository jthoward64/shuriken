# 15. Error Handling & Preconditions

## 15.1 DAV Error Response Format

```xml
<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:valid-calendar-data/>
</D:error>
```

## 15.2 Status Codes

| Code | Meaning |
|------|---------|
| 201 | Created |
| 204 | No Content (successful update) |
| 207 | Multi-Status (PROPFIND/REPORT responses) |
| 400 | Bad Request (parse error) |
| 403 | Forbidden (precondition/postcondition failed; repeating will not help) |
| 404 | Not Found |
| 409 | Conflict (precondition/postcondition failed; may be resolvable) |
| 412 | Precondition Failed (If-Match failed) |
| 415 | Unsupported Media Type |
| 507 | Insufficient Storage |

## 15.3 Precondition Elements

**CalDAV (RFC 4791)**:
- `valid-calendar-data`
- `valid-calendar-object-resource`
- `supported-calendar-component`
- `supported-calendar-data`
- `no-uid-conflict`
- `supported-filter`
- `valid-filter`
- `supported-collation`
- `number-of-matches-within-limits`
- `max-resource-size`
- `min-date-time` / `max-date-time`
- `max-instances`
- `max-attendees-per-instance`

**CardDAV (RFC 6352)**:

| Precondition | Triggered When |
|--------------|----------------|
| `CARDDAV:valid-address-data` | vCard syntax is invalid |
| `CARDDAV:supported-address-data` | Unsupported media type or vCard version |
| `CARDDAV:no-uid-conflict` | UID already in collection (or changed on update) |
| `CARDDAV:addressbook-collection-location-ok` | Invalid destination for COPY/MOVE |
| `CARDDAV:max-resource-size` | vCard exceeds size limit |
| `CARDDAV:supported-filter` | Query uses unsupported property/parameter |
| `CARDDAV:supported-collation` | Query uses unsupported collation |
| `CARDDAV:supported-address-data-conversion` | Cannot convert to requested format (GET Accept) |
| `DAV:number-of-matches-within-limits` | Query results exceed server limit |

**CardDAV Precondition Examples**:

```xml
<!-- Invalid vCard syntax -->
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:valid-address-data/>
</D:error>

<!-- UID conflict -->
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:no-uid-conflict>
    <D:href>/addressbooks/user/contacts/existing-contact.vcf</D:href>
  </C:no-uid-conflict>
</D:error>

<!-- Unsupported filter -->
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:supported-filter>
    <C:prop-filter name="X-CUSTOM-PROPERTY"/>
  </C:supported-filter>
</D:error>

<!-- Unsupported collation -->
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:supported-collation/>
</D:error>
```

Note: Some servers include extra, non-standard elements for debugging in error bodies. Clients should not depend on them.

---
