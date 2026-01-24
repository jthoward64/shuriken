# Shuriken CalDAV/CardDAV Architecture Plan

This document proposes a concrete, maintainable file structure and request control-flow for implementing CalDAV/CardDAV in Shuriken’s existing Rust skeleton.

It is written to match the current entrypoints:
- Server bootstrap: [src/main.rs](../src/main.rs)
- Routing root: [src/app/api/mod.rs](../src/app/api/mod.rs)
- Auth middleware: [src/component/middleware/auth.rs](../src/component/middleware/auth.rs)
- DB pool: [src/component/db/connection.rs](../src/component/db/connection.rs)
- Casbin enforcer: [src/component/auth/casbin.rs](../src/component/auth/casbin.rs)

## Design Goals

- Keep protocol glue in `src/app/` (HTTP, headers, XML bodies, status codes).
- Keep business logic in `src/component/` (validation, auth decisions, DB orchestration).
- Keep parsing/serialization in `src/component/rfc/` (iCalendar/vCard/XML), reusable by both CalDAV and CardDAV.
- Keep DB query composition in `src/component/db/query/` (pure functions returning Diesel queries/expressions).
- Keep files small and narrowly-scoped; prefer more modules over large modules.

## Proposed File Layout

### 1) HTTP API (Salvo) Layer — `src/app/`

Keep the HTTP surface area explicit: each HTTP method or REPORT type gets its own handler module.

```
src/
  app/
    mod.rs
    api/
      mod.rs
      app_specific/
        mod.rs
      dav/
        mod.rs
        extract/
          mod.rs
          xml_body.rs          # Extract WebDAV XML request bodies
          headers.rs           # Parse Depth, If-Match, Destination, etc.
        response/
          mod.rs
          multistatus.rs       # 207 builders, propstat helpers
          error.rs             # DAV error XML builders
        method/
          mod.rs
          options.rs
          propfind.rs
          proppatch.rs
          copy_move.rs
          mkcol.rs
      caldav/
        mod.rs                # Router + shared caldav wiring
        method/
          mod.rs
          mkcalendar.rs
          get_head.rs
          put.rs
          delete.rs
        report/
          mod.rs
          calendar_query.rs
          calendar_multiget.rs
          freebusy_query.rs
          sync_collection.rs   # (WebDAV Sync, but CalDAV relies heavily on it)
      carddav/
        mod.rs
        method/
          mod.rs
          get_head.rs
          put.rs
          delete.rs
          mkcol_extended.rs
        report/
          mod.rs
          addressbook_query.rs
          addressbook_multiget.rs
          expand_property.rs
      well_known/
        mod.rs
        caldav.rs
        carddav.rs
```

Notes:
- `app/api/dav/*` contains shared WebDAV mechanics (Depth, multistatus, standard DAV errors). Both CalDAV and CardDAV call into these helpers.
- CalDAV/CardDAV handlers should be “thin”: parse request → call a component service → format a response.

### 2) Service / Domain Layer — `src/component/`

Introduce clear “service boundaries” by protocol and cross-cutting concerns.

```
src/
  component/
    mod.rs
    error/
      mod.rs                 # component::error::Error + Result
    middleware/
      auth.rs                # already exists
    auth/
      mod.rs
      authenticate.rs        # already exists
      casbin.rs              # already exists
      authorize.rs           # NEW: high-level authorization API wrapping Casbin
      subject.rs             # NEW: Principal/user/group/public resolution
    config/
      mod.rs
    db/
      mod.rs
      connection.rs
      schema.rs
      map/
        mod.rs
        dav.rs               # NEW: DB <-> DAV canonical model mapping
        caldav.rs            # NEW
        carddav.rs           # NEW
      query/
        mod.rs
        dav/
          mod.rs
          collection.rs
          entity.rs
          instance.rs
          tombstone.rs
          sync.rs
        caldav/
          mod.rs
          calendar.rs
          event_index.rs
          freebusy.rs
        carddav/
          mod.rs
          addressbook.rs
          card_index.rs
    rfc/
      mod.rs
      dav/
        mod.rs
        xml/
          mod.rs
          request.rs          # typed request bodies (Propfind/Report/etc)
          response.rs         # typed response structs
          ser.rs
          de.rs
      ical/
        mod.rs
        core/
          mod.rs
        parse/
          mod.rs
        build/
          mod.rs
      vcard/
        mod.rs
        core/
          mod.rs
        parse/
          mod.rs
        build/
          mod.rs
    caldav/
      mod.rs
      service/
        mod.rs
        calendar.rs
        object.rs
        report.rs
        sync.rs
        schedule.rs
      validate/
        mod.rs
        preconditions.rs
    carddav/
      mod.rs
      service/
        mod.rs
        addressbook.rs
        object.rs
        report.rs
        sync.rs
      validate/
        mod.rs
        preconditions.rs
```

Notes:
- `component/*/service/*` orchestrates DB + parsing + auth.
- `component/*/validate/*` contains precondition checks and protocol-specific validation logic (e.g., `no-uid-conflict`, `valid-address-data`).
- `component/auth/authorize.rs` becomes the single place that translates high-level “intent” into Casbin `enforce()` calls.

### 3) Tests (recommended layout)

Prefer integration tests that exercise real HTTP behavior and DB side effects.

```
tests/
  dav_propfind.rs
  dav_proppatch.rs
  caldav_put_get.rs
  caldav_calendar_query.rs
  sync_collection.rs
  carddav_put_get.rs
  carddav_addressbook_query.rs
  auth_matrix.rs

src/component/rfc/ical/parse/tests.rs     # pure unit tests
src/component/rfc/vcard/parse/tests.rs
src/component/rfc/dav/xml/tests.rs
```

If you want purely in-process HTTP testing, Salvo’s `test` utilities support `Service::new(router)` + `TestClient` style tests.

## Control Flow (End-to-End)

### Startup

1. [src/main.rs](../src/main.rs)
   - Initialize tracing.
   - Load config.
   - Create DB pool (diesel-async + bb8).
   - Initialize Casbin enforcer (Diesel adapter + `casbin_model.conf`).
   - Build router: `/api/*`.

### Request Pipeline (every request)

1. **Router dispatch**
   - [src/app/api/mod.rs](../src/app/api/mod.rs) builds the `/api` subtree and applies `AuthMiddleware` via `hoop()`.

2. **Authentication middleware**
   - [src/component/middleware/auth.rs](../src/component/middleware/auth.rs)
   - Calls `authenticate(req)`.
   - Stores `DepotUser::{User, Public}` in `Depot`.
   - If hard-auth fails (bad headers/etc), returns `401` and `skip_rest()`.

3. **Handler** (CalDAV/CardDAV/WebDAV)
   - Parse headers: Depth, If-Match/If-None-Match, Destination, etc.
   - Parse body: iCalendar/vCard bytes or DAV XML.
   - Resolve “subject” from `Depot` (user or public principal).
   - Call `component::*::service::*` for the operation.

4. **Service layer**
   - Authorization: `component/auth/authorize.rs` calls Casbin `enforce()` with `(sub, obj, act)`.
   - DB: `component/db/connection::connect()` obtains a pooled async connection.
   - Query composition: `component/db/query/*` builds Diesel queries.
   - Mapping: `component/db/map/*` converts DB rows ↔ domain models.
   - Parsing/serialization: `component/rfc/*` turns bytes ↔ typed content.

5. **Response formatting**
   - For DAV XML: build a typed multistatus, then serialize.
   - For GET/HEAD: write bytes and set content-type.
   - Attach caching headers (ETag / Last-Modified) consistently.

## Method-Level Control Flow (Key Operations)

### PROPFIND (collections and resources)

**Entry**: `app/api/dav/method/propfind.rs`

1. Extract Depth (default to `0` per your chosen policy; many clients send it explicitly).
2. Parse DAV XML request body (`allprop` / `propname` / `prop`).
3. Resolve target resource(s):
   - Depth 0: target only
   - Depth 1: target + immediate children
4. For each href:
   - Authorize `read` (or a protocol-specific “propfind” action) against collection/item.
   - Read properties from DB and/or computed properties.
   - Build `propstat` 200 for supported props, 404 for unknown.
5. Serialize 207 Multi-Status.

### PUT (calendar object / vCard)

**Entry**: `app/api/caldav/method/put.rs` or `app/api/carddav/method/put.rs`

1. Parse conditional headers:
   - `If-None-Match: *` for safe create
   - `If-Match` for safe update
2. Read request bytes.
3. Parse content:
   - iCalendar for `.ics`
   - vCard for `.vcf`
4. Validate protocol-specific preconditions:
   - CalDAV: calendar object rules, UID stability
   - CardDAV: UID uniqueness (`no-uid-conflict`)
5. Authorize `edit` on the parent collection and/or object.
6. DB transaction:
   - Upsert canonical entity
   - Upsert instance in the collection
   - Update derived indexes
   - Create tombstones if href moved/overwritten
   - Bump collection sync token / CTag
7. Respond:
   - `201 Created` on create, `204 No Content` on update (common pattern)
   - Include ETag

### REPORT (Query Reports)

**Entry**: `app/api/caldav/report/*` and `app/api/carddav/report/*`

1. Parse report XML and validate collection type.
2. Authorize:
   - `read` for query/multiget
   - `read-freebusy` for free-busy
3. Use DB index tables to resolve candidate sets.
4. Apply filter semantics (including time-range + recurrence strategy).
5. Build multistatus with requested `prop` set.

### sync-collection (WebDAV Sync)

**Entry**: `app/api/caldav/report/sync_collection.rs` (or a shared dav/report module)

1. Enforce `Depth: 0`.
2. Validate token (`valid-sync-token` error if invalid).
3. Query changes since token:
   - Changed resources: include requested props (usually `getetag`)
   - Deleted resources: status-only `404` response
4. If truncated:
   - Include the extra `507` response for the request-URI and a token that continues paging.
5. Return new token.

## Responsibility Boundaries (Rules of Thumb)

- `app/*` never directly writes Diesel queries.
- `component/db/query/*` is pure query composition (no I/O).
- `component/*/service/*` owns transactions and sequencing (auth → parse → db → index → token).
- `component/rfc/*` does parsing/serialization only (no DB, no HTTP).
- DAV XML error bodies (precondition elements) should be constructed in one place to stay consistent.

## Recommended Internal APIs (to keep handlers thin)

- `component/auth/authorize::require(sub, obj, action) -> Result<()>`
- `component/dav/service::propfind(ctx, request) -> Result<Multistatus>`
- `component/caldav/service::put_calendar_object(ctx, href, bytes, conditions) -> Result<PutResult>`
- `component/carddav/service::put_vcard(ctx, href, bytes, conditions) -> Result<PutResult>`
- `component/*/service::report_*` per REPORT.

Each API takes a small `ctx` struct:
- subject/principal
- collection + resource identifiers
- optional request metadata (Depth, prefer, etc.)

## Compatibility With Current Skeleton

- Routing already centralizes under `/api` and uses `AuthMiddleware`; the plan keeps that and adds deeper routers for WebDAV/CalDAV/CardDAV.
- Global DB pool and Casbin enforcer are already `OnceLock`; the plan uses them via a small `authorize` wrapper.
- `component/rfc/*` already exists as the right place to implement parsers and serializers; this plan only adds submodules and typed request/response structs.
