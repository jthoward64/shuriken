# 17. RFC-by-RFC Coverage Checklist

This section is a “one-by-one” sanity checklist against the major RFCs that matter for interoperability. Each item points to the exact guide section(s) that describe the behavior and the phase(s) that implement it.

## RFC 4918 — WebDAV

- **Core methods**: `OPTIONS`, `PROPFIND`, `PROPPATCH`, `GET`, `HEAD`, `PUT`, `DELETE`, `COPY`, `MOVE`, `MKCOL` (Guide: [5.1 Method Routing](#51-method-routing), [5.7 PROPPATCH Handling](#57-proppatch-handling), [5.9 COPY and MOVE Handling](#59-copy-and-move-handling); Plan: Phase 3).
- **Collections vs resources**: correct `DAV:resourcetype`, `DAV:collection` semantics, and consistent `href` handling (Guide: [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 3).
- **Multi-Status correctness**: `207 Multi-Status`, per-resource `propstat`, accurate `status` per property (Guide: [5.3 PROPFIND Handling](#53-propfind-handling), [15.1 DAV Error Response Format](#151-dav-error-response-format); Plan: Phase 3).
- **Depth handling**: support `Depth: 0` and `Depth: 1`; explicitly document/implement behavior for `infinity` (Guide: [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 3).
- **ETags and conditional requests**: strong ETags; `If-Match` / `If-None-Match: *` semantics for optimistic locking and safe create (Guide: [5.4 PUT Handling](#54-put-handling), [7.3 ETag Handling](#73-etag-handling); Plan: Phase 3).

## RFC 3253 — WebDAV Versioning (REPORT framework)

- **REPORT method**: parse/dispatch REPORT bodies; return proper errors on unknown/unsupported reports (Guide: [6. REPORT Operations](#6-report-operations); Plan: Phase 4).
- **`DAV:supported-report-set`**: advertise supported reports per collection/resource type and keep it consistent with what REPORT handlers exist (Guide: [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 3 + Phase 4).
- **`DAV:expand-property` report**: required by CardDAV clients for common discovery paths (Guide: [6.6 DAV expand-property Report](#66-dav-expand-property-report-rfc-3253-38); Plan: Phase 4).

## RFC 3744 — WebDAV ACL

- **Privileges**: enforce read/write/owner-like permissions consistently across WebDAV and DAV-specific operations (Guide: [12.1 WebDAV ACL](#121-webdav-acl-rfc-3744), [12.3 Shuriken ACL Model](#123-shuriken-acl-model); Plan: Phase 8).
- **Discovery properties**: return `DAV:current-user-privilege-set` and related ACL discovery properties so clients can determine what UI/actions to enable (Guide: [12.4 ACL Discovery Properties](#124-acl-discovery-properties), [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 8).
- **401 vs 403 discipline**: authentication failures vs authorization failures, and consistent behavior across methods (Guide: [15.2 Status Codes](#152-status-codes), [12. Authorization & Access Control](#12-authorization--access-control); Plan: Phase 3 + Phase 8).

## RFC 4791 — CalDAV

- **Discovery**: `CALDAV:calendar-home-set` and calendar collection properties used by clients (Guide: [5.3 PROPFIND Handling](#53-propfind-handling), [13.2 Principal Discovery](#132-principal-discovery); Plan: Phase 3).
- **Calendar object semantics**: one iCalendar object per resource; enforce UID rules and preconditions (`no-uid-conflict`, etc.) (Guide: [2. Data Formats](#2-data-formats), [5.4 PUT Handling](#54-put-handling), [15.3 Precondition Elements](#153-precondition-elements); Plan: Phase 1 + Phase 3).
- **Required REPORTs**: `calendar-query`, `calendar-multiget`, `free-busy-query` (Guide: [6.1 CALDAV:calendar-query](#61-caldavcalendar-query-rfc-4791-78), [6.2 CALDAV:calendar-multiget](#62-caldavcalendar-multiget-rfc-4791-79), [6.5 CALDAV:free-busy-query](#65-caldavfree-busy-query-rfc-4791-710), [10. Free-Busy Queries](#10-free-busy-queries); Plan: Phase 4 + Phase 7).
- **MKCALENDAR**: support calendar creation (SHOULD) and property setting at create time (Guide: [5.6 MKCALENDAR Handling](#56-mkcalendar-handling-rfc-4791-531); Plan: Phase 3).
- **Filter behavior**: time-range filtering + recurrence interaction; return `supported-filter` when you intentionally do not implement a filter feature (Guide: [6.1 CALDAV:calendar-query](#61-caldavcalendar-query-rfc-4791-78), [8.4 Time-Range Query with Recurrence](#84-time-range-query-with-recurrence), [15.3 Precondition Elements](#153-precondition-elements); Plan: Phase 4 + Phase 5).

## RFC 5545 — iCalendar

- **Parsing/serialization correctness**: unfolding/folding, parameter quoting/escaping, and deterministic serialization for stable ETags (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [4. Serialization](#4-serialization); Plan: Phase 1).
- **Validation semantics**: enforce required properties (e.g., VEVENT `DTSTART`), handle overrides (`RECURRENCE-ID`), and keep UID stable (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [5.4 PUT Handling](#54-put-handling); Plan: Phase 1 + Phase 3).
- **Recurrence expansion**: RRULE/RDATE/EXDATE correctness and limits (`max-instances`) (Guide: [8. Recurrence Expansion](#8-recurrence-expansion), [8.1 RRULE Evaluation Algorithm](#81-rrule-evaluation-algorithm-rfc-5545-3310); Plan: Phase 5).

## RFC 7986 — iCalendar Extensions

- **Non-fatal extension handling**: preserve unknown `X-` and IANA-registered properties/params without dropping them (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [4. Serialization](#4-serialization); Plan: Phase 1).
- **Common modern fields**: round-trip `COLOR`, `REFRESH-INTERVAL`, `SOURCE`, etc., since clients use them even when servers don’t “understand” them (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization); Plan: Phase 1).

## RFC 6578 — WebDAV Sync

- **`DAV:sync-token`**: expose on sync-enabled collections; document how clients discover and cache it (Guide: [7.1 WebDAV Sync](#71-webdav-sync-rfc-6578), [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 6).
- **`sync-collection` REPORT**: token validation, incremental change listing, tombstones, and new token issuance (Guide: [7.1 WebDAV Sync](#71-webdav-sync-rfc-6578); Plan: Phase 6).
- **Change accounting**: ensure every mutating operation bumps the collection token and produces correct tombstones for deletes (Guide: [5.5 DELETE Handling](#55-delete-handling), [7.1 WebDAV Sync](#71-webdav-sync-rfc-6578); Plan: Phase 2 + Phase 3 + Phase 6).

## RFC 6352 — CardDAV

- **Discovery**: `CARDDAV:addressbook-home-set`, `CARDDAV:supported-address-data`, and addressbook collection constraints (Guide: [1.2 CardDAV](#12-carddav-rfc-6352), [5.3 PROPFIND Handling](#53-propfind-handling), [13.2 Principal Discovery](#132-principal-discovery); Plan: Phase 3).
- **Required REPORTs**: `addressbook-query` and `addressbook-multiget` (Guide: [6.3 CARDDAV:addressbook-query](#63-carddavaddressbook-query-rfc-6352-86), [6.4 CARDDAV:addressbook-multiget](#64-carddavaddressbook-multiget-rfc-6352-87); Plan: Phase 4).
- **UID uniqueness + `no-uid-conflict`**: enforce UID constraints on create/update and return the correct precondition XML on conflicts (Guide: [5.4 PUT Handling](#54-put-handling), [15.3 Precondition Elements](#153-precondition-elements); Plan: Phase 3).
- **Query behavior**: implement property filters + text matching, and return `supported-filter` / `supported-collation` when you intentionally do not support a feature (Guide: [6.3 CARDDAV:addressbook-query](#63-carddavaddressbook-query-rfc-6352-86), [15.3 Precondition Elements](#153-precondition-elements); Plan: Phase 4).
- **`DAV:expand-property`**: required for client discovery flows (Guide: [6.6 DAV expand-property Report](#66-dav-expand-property-report-rfc-3253-38); Plan: Phase 4).
- **Extended MKCOL**: accept Extended MKCOL bodies to create address books with initial properties (Guide: [5.8 Extended MKCOL for Address Books](#58-extended-mkcol-for-address-books-rfc-5689); Plan: Phase 3).

## RFC 6350 — vCard 4.0 (plus vCard 3 interoperability)

- **Media type/version support**: MUST support vCard 3.0 for CardDAV interop; SHOULD support vCard 4.0; be explicit about which you store/emit (Guide: [1.2 CardDAV](#12-carddav-rfc-6352), [2. Data Formats](#2-data-formats), [3. Parsing & Deserialization](#3-parsing--deserialization); Plan: Phase 1 + Phase 3).
- **Round-trip safety**: preserve unknown properties/params; handle line folding/unfolding and escaping correctly (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [4. Serialization](#4-serialization); Plan: Phase 1).
- **Timestamp/value rules**: accept truncation where allowed and normalize output for stable ETags when possible (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [4. Serialization](#4-serialization), [5.4 PUT Handling](#54-put-handling); Plan: Phase 1 + Phase 3).

## RFC 6868 — Parameter Value Encoding

- **Caret encoding**: handle `^n`, `^'`, and `^^` in parameter values (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization); Plan: Phase 1).

## RFC 5689 — Extended MKCOL

- **Address book creation**: accept Extended MKCOL bodies and apply `displayname`/`addressbook-description` at creation time (Guide: [5.8 Extended MKCOL for Address Books](#58-extended-mkcol-for-address-books-rfc-5689); Plan: Phase 3).

## RFC 6764 / RFC 5785 — Service Discovery / Well-Known URIs

- **`/.well-known/caldav` and `/.well-known/carddav`**: implement redirects and/or direct responses in a way common clients accept (Guide: [13.1 Well-Known URIs](#131-well-known-uris-rfc-6764); Plan: Phase 9).
- **Consistent principal discovery**: ensure well-known ultimately leads clients to `current-user-principal` and home sets reliably (Guide: [13.2 Principal Discovery](#132-principal-discovery), [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 9 + Phase 3).
