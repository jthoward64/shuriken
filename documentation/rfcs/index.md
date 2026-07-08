# RFC Index

Reference index for all RFCs relevant to this CalDAV/CardDAV server implementation.

## Core WebDAV

| RFC | Title | Date | Notes |
|-----|-------|------|-------|
| [RFC 4918](rfc4918.txt) | HTTP Extensions for Web Distributed Authoring and Versioning (WebDAV) | June 2007 | Obsoletes RFC 2518. Defines WebDAV methods, headers, properties, collections, locking, and namespace operations. **Primary WebDAV reference.** |
| [RFC 3253](rfc3253.txt) | Versioning Extensions to WebDAV | March 2002 | Defines version history management, workspaces, baselines, activities, and automatic versioning for WebDAV. |
| [RFC 3744](rfc3744.txt) | WebDAV Access Control Protocol | May 2004 | Defines ACL methods, properties, and principal resources for reading and modifying access control lists on WebDAV resources. |
| [RFC 5689](rfc5689.txt) | Extended MKCOL for WebDAV | September 2009 | Extends the MKCOL method to create collections of arbitrary resource types and set properties atomically. Updates RFC 4791 and RFC 4918. |
| [RFC 6578](rfc6578.txt) | Collection Synchronization for WebDAV | March 2012 | Defines the `sync-collection` REPORT for efficient delta synchronization of WebDAV collection contents using sync tokens. |

## CalDAV

| RFC | Title | Date | Notes |
|-----|-------|------|-------|
| [RFC 4791](rfc4791.txt) | Calendaring Extensions to WebDAV (CalDAV) | March 2007 | Defines the `calendar-access` feature: calendar collections, iCalendar object resources, MKCALENDAR, and calendar-query/multiget REPORTs. **Primary CalDAV reference.** |
| [RFC 6638](rfc6638.txt) | Scheduling Extensions to CalDAV | June 2012 | Defines the `calendar-auto-schedule` feature for server-side iTIP scheduling (invites, replies, cancellations) via CalDAV. Updates RFC 4791 and RFC 5546. |
| [RFC 7809](rfc7809.txt) | CalDAV: Time Zones by Reference | March 2016 | Allows CalDAV clients and servers to exchange iCalendar data using TZID references instead of embedding full VTIMEZONE components. Updates RFC 4791. |
| [RFC 6764](rfc6764.txt) | Locating Services for CalDAV and CardDAV | February 2013 | Describes how DNS SRV records, DNS TXT records, and well-known URIs are used to discover CalDAV and CardDAV service endpoints. Updates RFC 4791 and RFC 6352. |

## CardDAV

| RFC | Title | Date | Notes |
|-----|-------|------|-------|
| [RFC 6352](rfc6352.txt) | CardDAV: vCard Extensions to WebDAV | August 2011 | Defines CardDAV: addressbook collections, vCard object resources, and addressbook-query/multiget REPORTs for contact management over WebDAV. **Primary CardDAV reference.** |

## iCalendar

| RFC | Title | Date | Notes |
|-----|-------|------|-------|
| [RFC 5545](rfc5545.txt) | Internet Calendaring and Scheduling Core Object Specification (iCalendar) | September 2009 | Defines the iCalendar data format (VCALENDAR, VEVENT, VTODO, VJOURNAL, VFREEBUSY, VTIMEZONE, VALARM). Obsoletes RFC 2445. **Primary iCalendar reference.** |
| [RFC 6868](rfc6868.txt) | Parameter Value Encoding in iCalendar and vCard | February 2013 | Extends iCalendar (RFC 5545) and vCard (RFC 6350) parameter value syntax to allow characters such as double-quotes, colons, and semicolons via `^` escaping. |
| [RFC 7529](rfc7529.txt) | Non-Gregorian Recurrence Rules in iCalendar | May 2015 | Extends iCalendar RRULE to support non-Gregorian calendar systems (Hebrew, Chinese, etc.) and defines CalDAV server/client handling for these rules. Updates RFC 5545. |
| [RFC 7953](rfc7953.txt) | Calendar Availability | August 2016 | Introduces the VAVAILABILITY iCalendar component for publishing available/unavailable time periods, and defines how CalDAV uses it for free-busy evaluation. Updates RFC 4791, RFC 5545, and RFC 6638. |
| [RFC 7986](rfc7986.txt) | New Properties for iCalendar | October 2016 | Defines new calendar-level iCalendar properties: NAME, DESCRIPTION, UID, LAST-MODIFIED, URL, CATEGORIES, REFRESH-INTERVAL, SOURCE, and COLOR. Updates RFC 5545. |
| [RFC 9073](rfc9073.txt) | Event Publishing Extensions to iCalendar | August 2021 | Adds iCalendar properties and components for event publishing and social networking use cases, including STRUCTURED-DATA and new relationship types. Updates RFC 5545. |
| [RFC 9074](rfc9074.txt) | "VALARM" Extensions for iCalendar | August 2021 | Extends the VALARM component with UID, RELATED-TO, ACKNOWLEDGED, snooze support, and proximity-based triggers. Updates RFC 5545. |
| [RFC 9253](rfc9253.txt) | Support for iCalendar Relationships | August 2022 | Updates RELATED-TO with new relation types and introduces the LINK, CONCEPT, and REFID properties for richer linking and grouping of iCalendar components. Updates RFC 5545. |

## vCard

| RFC | Title | Date | Notes |
|-----|-------|------|-------|
| [RFC 6350](rfc6350.txt) | vCard Format Specification | August 2011 | Defines the vCard 4.0 data format for representing individuals and organizations. Obsoletes RFC 2425, RFC 2426, and RFC 4770. Updates RFC 2739. **Primary vCard reference.** |
| [RFC 2739](rfc2739.txt) | Calendar Attributes for vCard and LDAP | January 2000 | Defines vCard properties (FBURL, CALADRURI, CALURI) and LDAP schema extensions for storing calendar and free/busy URIs in contact records. |
| [RFC 9554](rfc9554.txt) | vCard Format Extensions for JSContact | May 2024 | Adds new vCard properties and extends existing ones to align vCard with the JSContact format. Updates RFC 6350. |

## Collation and String Comparison

| RFC | Title | Date | Notes |
|-----|-------|------|-------|
| [RFC 4790](rfc4790.txt) | Internet Application Protocol Collation Registry | March 2007 | Defines an IANA registry and abstraction framework for string collation (comparison/sorting) functions used by protocols such as CalDAV text-match filters. |
| [RFC 5051](rfc5051.txt) | i;unicode-casemap — Simple Unicode Collation Algorithm | October 2007 | Defines the `i;unicode-casemap` collation: a simple case-insensitive Unicode string comparison providing equality, substring, and ordering operations. |

## Dependency Map

```
RFC 4918  (WebDAV core)
  ├── RFC 3253  (versioning)
  ├── RFC 3744  (ACL)
  ├── RFC 5689  (extended MKCOL)
  ├── RFC 6578  (collection sync)
  └── RFC 4791  (CalDAV)
        ├── RFC 6638  (CalDAV scheduling)
        ├── RFC 7809  (time zones by reference)
        └── RFC 7953  (calendar availability)

RFC 5545  (iCalendar core)
  ├── RFC 6868  (parameter encoding)
  ├── RFC 7529  (non-Gregorian recurrence)
  ├── RFC 7986  (new iCalendar properties)
  ├── RFC 9073  (event publishing extensions)
  ├── RFC 9074  (VALARM extensions)
  └── RFC 9253  (iCalendar relationships)

RFC 6350  (vCard core)
  ├── RFC 2739  (calendar attributes for vCard)
  ├── RFC 6352  (CardDAV)
  ├── RFC 6868  (parameter encoding)
  └── RFC 9554  (JSContact extensions)

RFC 6764  (service discovery for CalDAV + CardDAV)

RFC 4790  (collation registry)
  └── RFC 5051  (i;unicode-casemap collation)
```
