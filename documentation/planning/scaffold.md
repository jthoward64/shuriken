# Scaffold Plan: iCalendar/vCard Parsing, ACL Stub, Collections, and Entries

## Scope

This plan covers the minimum work to make the server functional for creating and retrieving
CalDAV collections and entries:

1. iCalendar and vCard parsing and serialization
2. ACL allow-all stub (unblocks handler development)
3. Create collections (`MKCOL`, `MKCALENDAR`, `MKADDRESSBOOK`)
4. Create and retrieve entries (`PUT`, `GET`/`HEAD`)
5. Discover collections and entries (`PROPFIND`)

## Key design decisions

### Normalized-only storage (no raw content column)

The `dav_component` and `dav_property` tables are the single source of truth for entity
content. There is no raw-content fallback column. This means:

- **PUT** fully parses the incoming text into a typed intermediate representation, then persists
  that representation to `dav_entity` / `dav_component` / `dav_property` / `dav_parameter`.
- **GET** reconstructs the entity by reading those tables and serializing back to text.

This eliminates dual-storage and ensures REPORT queries can be built directly on top of the
same data that GET uses, with no synchronization gap.

The ETag is computed from the canonical serialized form (not the client's original bytes) and
stored on `dav_instance`. Clients receive this ETag in PUT and GET responses and use it for
conditional requests. Byte-for-byte fidelity with what the client sent is not required.

### Intermediate representation (IR)

Rather than coupling the parser directly to Drizzle row types, parsing produces a typed
intermediate representation (IR) defined in `src/data/`. The same IR is consumed by both the
persister (IR → DB rows) and the serializer (IR → text). This keeps the parser, serializer, and
DB layer independently testable.

### MKCOL path resolution

The DAV router resolves slugs to UUIDs at entry. MKCOL targets a *non-existent* collection, so
path resolution would 404 before reaching the handler. The fix is to add `new-collection` and
`new-instance` variants to `ResolvedDavPath` and teach `parseDavPath` to fall back to these
instead of failing with 404 when the resource is absent.

### Entity management

`InstanceService.put()` takes an `entityId`, implying entity creation is the caller's
responsibility. A new `EntityRepository` handles inserting `dav_entity` rows. Separate
`ComponentRepository` and `PropertyRepository` handle the normalized content. The PUT handler
orchestrates all three in a logical transaction: create entity → persist components/properties
→ create instance.

---

## Steps

### Step 1 — Intermediate representation schemas

**Modified file**: `src/data/ir.ts`

Redefine all IR types as Effect Schema types so that TypeScript types are derived from schemas,
enabling runtime validation, composable Schema pipelines, and future Schema-based REPORT
filtering without a separate validation layer.

`IrParameter` and `IrProperty` are `Schema.Struct`. `IrValue` is a `Schema.Union` discriminated
on the `type` field (matching every `value_type` in the `dav_property_value_type_check`
constraint). `IrComponent` is a `Schema.Struct` with a `Schema.suspend` reference for the
recursive `components` field. `IrDocument` is a `Schema.Union` on `kind`.

Temporal types (`Temporal.PlainDate`, `Temporal.ZonedDateTime`, `Temporal.PlainDateTime`) do not
have first-class Effect Schema support; define them with `Schema.declare` and type-guard
predicates. `ClarkName`, `IrDeadProperty`, and `IrDeadProperties` are kept as template-literal
types and plain interfaces — they are used only at the XML/JSON boundary where Schema composition
is not needed.

All IR TypeScript types are derived: `export type IrProperty = Schema.Schema.Type<typeof IrPropertySchema>` etc.
The already-implemented `src/data/ir.ts` satisfies this step structurally; this step exists to
document the intent and to flag that the Schema derivation pattern should be applied if the file
is edited.

---

### Step 1b — Content-line codec

**New file**: `src/data/content-line.ts`

Both iCalendar (RFC 5545 §3.1) and vCard (RFC 6350 §3.2) share the same line-based text
format: logical lines are folded at 75 octets with CRLF+WSP continuation, and properties follow
the `NAME;PARAM=VALUE:raw-value` grammar. This module owns that shared layer so the format
codecs (Steps 2 and 3) never duplicate it.

```typescript
// A parsed parameter. RFC 5545 §3.2 allows multiple comma-separated values per parameter;
// values is a non-empty array capturing each individual value.
export interface ContentLineParam {
  readonly name: string;
  readonly values: ReadonlyArray<string>; // at least one entry
}

// A single logical content line after unfolding, parsed into its structural parts.
// rawValue is the verbatim text after the first ":" — value type inference happens
// at the IrProperty layer, not here.
export interface ContentLine {
  readonly name: string;            // upper-cased property/component name
  readonly params: ReadonlyArray<ContentLineParam>;
  readonly rawValue: string;
}

// Schema<ReadonlyArray<ContentLine>, string>
// decode: normalize CRLF, unfold continuation lines, split, parse each line
// encode: serialize each ContentLine to NAME;PARAMS:rawValue, fold at 75 octets,
//         join with CRLF, append trailing CRLF
export const ContentLinesCodec: Schema.Schema<ReadonlyArray<ContentLine>, string>
```

Decoding errors (malformed property line) surface as `Schema.ParseError`; callers map to the
appropriate `DavError` precondition.

**Test file**: `src/data/content-line.unit.test.ts`
- Decodes a CRLF-terminated block into the correct `ContentLine` array
- Normalizes lone `\n` to `\r\n` before splitting
- Unfolds `\r\n<SPACE>` and `\r\n<TAB>` continuation lines
- Preserves semicolons and colons inside quoted parameter values
- Splits multi-value parameters at unquoted commas
- Encodes a `ContentLine` array back to folded CRLF text at ≤75 octets per line
- Round-trips: decode → encode → decode yields same `ContentLine` array

---

### Step 1c — Component-tree codec

**New file**: `src/data/component-tree.ts`

Converts a flat `ContentLine` sequence into a nested component tree and back. This is the
stack-based `BEGIN:`/`END:` layer shared by both format codecs. Value type inference does
**not** happen here; properties remain as `ContentLine`s so that format-specific lookup tables
can be applied in the next step.

```typescript
// Intermediate component tree: structurally parsed but properties not yet typed.
export interface RawComponent {
  readonly name: string;
  readonly contentLines: ReadonlyArray<ContentLine>;   // non-BEGIN/END property lines
  readonly children: ReadonlyArray<RawComponent>;
}

// Schema<RawComponent, ReadonlyArray<ContentLine>>
// decode: stack-drives BEGIN:/END:, nests children, collects remaining lines as contentLines
// encode: depth-first emit of BEGIN:name, contentLines, children, END:name
export const RawComponentCodec: Schema.Schema<RawComponent, ReadonlyArray<ContentLine>>
```

Decoding fails if `BEGIN` and `END` names do not match, or if the document has more than one
root component.

**Test file**: `src/data/component-tree.unit.test.ts`
- Decodes a flat `ContentLine` sequence into a single root with nested children
- Property `ContentLine`s are attached to the correct component, not hoisted
- Fails when an `END:X` name does not match the open `BEGIN:X`
- Fails when there are multiple root components (ambiguous document)
- Encodes a `RawComponent` tree back to the correct `ContentLine` sequence with `BEGIN:`/`END:`
- Round-trips: decode → encode → decode yields same `RawComponent` tree

---

### Step 2 — iCalendar codec

**New files**: `src/data/icalendar/codec.ts`, `src/data/icalendar/uid.ts`

The iCalendar codec composes the shared pipeline from Steps 1b–1c with two
iCalendar-specific stages, producing a single `Schema<IrDocument, string>`:

```
string
  →[ContentLinesCodec]   ReadonlyArray<ContentLine>
  →[RawComponentCodec]   RawComponent
  →[ICalPropertyInferrer]   IrComponent          (iCal value-type lookup per RFC 5545 §3.8)
  →[ICalDocumentCodec]   IrDocument           (validates VCALENDAR root, sets kind)
```

```typescript
// Schema<IrComponent, RawComponent>
// decode: maps each ContentLine → IrProperty via iCal lookup table + VALUE= override;
//         unknown/X- names → { type: "TEXT", isKnown: false }; recurses into children
// encode: maps each IrProperty → ContentLine using IrValue type tag
const ICalPropertyInferrer: Schema.Schema<IrComponent, RawComponent>

// Schema<IrDocument, IrComponent>
// decode: asserts root.name === "VCALENDAR", wraps as { kind: "icalendar", root }
// encode: unwraps root component
const ICalDocumentCodec: Schema.Schema<IrDocument, IrComponent>

// Full bidirectional codec via Schema.compose
export const ICalendarCodec: Schema.Schema<IrDocument, string>

// Convenience wrappers — map Schema.ParseError to DavError at the HTTP edge
export const decodeICalendar = (text: string): Effect.Effect<IrDocument, DavError>
export const encodeICalendar = (doc: IrDocument): Effect.Effect<string, never>
```

`decodeICalendar` maps `ParseError` → `validCalendarData(...)`.
`encodeICalendar` uses `Effect.orDie` — encoding a structurally valid `IrDocument` cannot fail.

**`src/data/icalendar/uid.ts`**:

```typescript
// Finds the UID property value in the first non-VCALENDAR component (VEVENT, VTODO, etc.)
export const extractUid = (doc: IrDocument): Option.Option<string>
```

**Test file**: `src/data/icalendar/codec.unit.test.ts`
- Decodes a minimal VCALENDAR with one VEVENT
- Correctly types DTSTART as `DATE` vs `DATE_TIME` based on `VALUE=` parameter
- DTSTART with `TZID=` parameter decodes to `DATE_TIME` holding a `ZonedDateTime`
- DTSTART without `Z` or `TZID` decodes to `PLAIN_DATE_TIME` holding a `PlainDateTime`
- Stores X- and unrecognized IANA properties as `TEXT` with `isKnown: false`
- Fails with `validCalendarData` on missing `BEGIN:VCALENDAR` root
- Round-trips: decode → encode → decode yields same `IrDocument`
- Encoded output folds lines at ≤75 octets with `\r\n` endings
- X-/unknown properties are emitted verbatim

---

### Step 3 — vCard codec

**New files**: `src/data/vcard/codec.ts`, `src/data/vcard/uid.ts`

Identical pipeline shape to Step 2, swapping in vCard-specific stages:

```
string
  →[ContentLinesCodec]   ReadonlyArray<ContentLine>
  →[RawComponentCodec]   RawComponent
  →[VCardPropertyInferrer]  IrComponent          (vCard value-type lookup per RFC 6350 §5)
  →[VCardDocumentCodec]  IrDocument           (validates VCARD root, sets kind)
```

```typescript
export const VCardCodec: Schema.Schema<IrDocument, string>

export const decodeVCard = (text: string): Effect.Effect<IrDocument, DavError>
export const encodeVCard = (doc: IrDocument): Effect.Effect<string, never>
```

`decodeVCard` maps `ParseError` → `validAddressData(...)`.

**`src/data/vcard/uid.ts`**:

```typescript
// Finds UID on the root VCARD component
export const extractUid = (doc: IrDocument): Option.Option<string>
```

**Test file**: `src/data/vcard/codec.unit.test.ts`
- Decodes a minimal VCARD with FN and UID
- Stores X- and unrecognized IANA properties as `TEXT` with `isKnown: false`
- Fails with `validAddressData` on missing `BEGIN:VCARD` root
- Round-trips: decode → encode → decode yields same `IrDocument`
- Encoded output folds lines at ≤75 octets with `\r\n` endings
- X-/unknown properties are emitted verbatim

---

### Step 4 — Entity, Component, and Property repositories

These three repositories handle the normalized content layer. None requires a service wrapper —
the logic is trivial CRUD.

**New file**: `src/services/entity/repository.ts`

```typescript
export interface EntityRepositoryShape {
  readonly insert: (input: {
    entityType: "icalendar" | "vcard";
    logicalUid: string | null;
  }) => Effect<EntityRow, DatabaseError>;

  readonly findById: (id: EntityId) => Effect<Option<EntityRow>, DatabaseError>;

  readonly updateLogicalUid: (id: EntityId, logicalUid: string | null) => Effect<void, DatabaseError>;
}
```

**New file**: `src/services/component/repository.ts`

```typescript
export interface ComponentRepositoryShape {
  readonly insertTree: (
    entityId: EntityId,
    root: IrComponent,
  ) => Effect<ComponentId, DatabaseError>; // returns root component id

  readonly loadTree: (entityId: EntityId) => Effect<Option<IrComponent>, DatabaseError>;

  readonly deleteByEntity: (entityId: EntityId) => Effect<void, DatabaseError>;
}
```

`insertTree` walks the `IrComponent` tree, inserting `dav_component` rows (with `parentComponentId`
set for nested components) and `dav_property` rows (mapping `IrValue` variants to the correct
`valueType` and value column), and `dav_parameter` rows. All inserts for a single PUT happen
within one Drizzle transaction.

`loadTree` reads all `dav_component` + `dav_property` + `dav_parameter` rows for an entity
and reconstructs the `IrComponent` tree.

`deleteByEntity` soft-deletes (sets `deletedAt`) all component rows for the entity, cascading
to properties and parameters via DB foreign keys (already set up as `ON DELETE CASCADE`).

Each gets a corresponding `*.live.ts` Drizzle implementation and an `index.ts` exporting the
tag + layer.

**Update** `src/layers.ts`:
- Add `withInfra(EntityDomainLayer)`, `withInfra(ComponentDomainLayer)` to `AppLayer`.
- Export the new tags from the re-export block.

**Test files** (written alongside the code):

`src/services/component/repository.integration.test.ts`:
- `insertTree` persists a multi-level component tree (VCALENDAR → VEVENT with properties and parameters)
- `loadTree` reconstructs the same IR tree that was inserted
- `loadTree` returns `Option.none()` for an unknown entity
- `deleteByEntity` soft-deletes all components; subsequent `loadTree` returns `Option.none()`
- `insertTree` and `loadTree` round-trip TEXT, DATE_TIME, DATE, TEXT_LIST, and RECUR value types
- `insertTree` and `loadTree` preserve `isKnown: false` properties verbatim

---

### Step 5 — ACL allow-all stub

**New file**: `src/services/acl/service.allow-all.ts`

```typescript
const ALL_PRIVILEGES: ReadonlyArray<DavPrivilege> = [ /* every DavPrivilege value */ ];

export const AclServiceAllowAll = Layer.succeed(
  AclService,
  AclService.of({
    check: (_principalId, _resourceUrl, _privilege) => Effect.void,
    currentUserPrivileges: (_principalId, _resourceUrl) =>
      Effect.succeed(ALL_PRIVILEGES),
  }),
);
```

**Update** `src/services/acl/index.ts` to export `AclServiceAllowAll`.

**Update** `src/layers.ts`: replace `withInfra(AclDomainLayer)` with `AclServiceAllowAll` in
`AppLayer`. Mark with a comment to swap back once ACL is wired into handlers properly.

**Test file** (written alongside the code):

`src/services/acl/service.allow-all.unit.test.ts`:
- `check` returns `Effect.void` for every privilege
- `currentUserPrivileges` returns every `DavPrivilege` value

---

### Step 6 — Path type: add new-resource variants

**File**: `src/domain/types/path.ts`

Extend `ResolvedDavPath`:

```typescript
| { readonly kind: "new-collection"; readonly principalId: PrincipalId; readonly slug: Slug }
| { readonly kind: "new-instance";   readonly principalId: PrincipalId; readonly collectionId: CollectionId; readonly slug: Slug }
```

**File**: `src/http/dav/router.ts`

Change `parseDavPath` to fall back to these variants instead of propagating 404:

- At the collection lookup: `Effect.catchIf` on 404 `DavError`, return `{ kind: "new-collection", principalId, slug: collSlug }`.
- At the instance lookup (only reached when the collection was found): same pattern, return `{ kind: "new-instance", principalId, collectionId, slug: objSlug }`.

Non-404 errors propagate unchanged.

Update all existing method handlers to handle the two new path kinds exhaustively (mostly 405).

**Test file** (written alongside the code):

`src/http/dav/router.unit.test.ts`:
- A URL for a non-existent collection resolves to `kind: "new-collection"` with the correct slug
- A URL for a non-existent instance under an existing collection resolves to `kind: "new-instance"`
- A URL for a non-existent principal still returns 404 (not swallowed by the new variants)
- A URL for a non-existent collection under a non-existent principal still returns 404

---

### Step 7 — MKCOL/MKCALENDAR/MKADDRESSBOOK handler

**File**: `src/http/dav/methods/mkcol.ts`

Requirements type: `CollectionService | AclService`

Logic:

1. Reject anything that is not `kind: "new-collection"` with 405.
2. `AclService.check(principalId, resourceUrl, "DAV:bind")`.
3. Derive `collectionType` from method: `MKCALENDAR` → `"calendar"`, `MKADDRESSBOOK` → `"addressbook"`, `MKCOL` → `"collection"`.
4. Parse optional XML body (extended-MKCOL per RFC 5689): walk `DAV:mkcol → DAV:set → DAV:prop`
   to extract `DAV:displayname`, `CALDAV:calendar-description`, and
   `CALDAV:supported-calendar-component-set`. Tolerate absent or malformed bodies.
5. `CollectionService.create({ ownerPrincipalId, collectionType, slug, displayName, ... })`.
6. Return `201 Created` with a `Location` header pointing to the new collection URL.

**Test file** (written alongside the code):

`src/http/dav/methods/mkcol.unit.test.ts`:
- MKCALENDAR on a `new-collection` path creates a calendar and returns 201 with Location
- MKADDRESSBOOK on a `new-collection` path creates an addressbook and returns 201 with Location
- MKCOL on a `new-collection` path creates a plain collection and returns 201 with Location
- Parses display name and description from extended-MKCOL body when present
- Succeeds with no body (tolerates absent XML)
- Returns 405 for any path kind other than `new-collection`

---

### Step 8 — PROPFIND handler

**File**: `src/http/dav/methods/propfind.ts`

Requirements type: `CollectionService | InstanceService | AclService`

**New helper file**: `src/http/dav/xml/multistatus.ts`

Export `buildMultistatus(responses: ReadonlyArray<DavResponse>): Effect<string, never>` that
produces a 207 Multi-Status XML body using `fast-xml-builder`. DAV namespace declarations go on
`D:multistatus` as attributes (`@_xmlns:D="DAV:"`, etc.).

```typescript
interface DavResponse {
  readonly href: string;
  readonly propstats: ReadonlyArray<{
    readonly props: Record<string, unknown>;
    readonly status: number;
  }>;
}
```

PROPFIND logic:

1. Read `Depth` header (default `0`). Reject `infinity` with 403 + `DAV:propfind-finite-depth`.
2. Parse XML body: `DAV:allprop`, `DAV:propname`, or named `DAV:prop`. Treat absent body as `allprop`.
3. Dispatch on `path.kind`:
   - `collection`: `CollectionService.findById`, build collection response. If `Depth: 1`,
     also `InstanceService.listByCollection` and append one response per instance.
   - `instance`: `InstanceService.findById`, build single instance response.
   - `principal`: minimal response with `DAV:resourcetype` and `DAV:displayname`.
   - `new-collection` / `new-instance`: 404.
4. Split properties into two `propstat` blocks: found (200) and not-found (404).

**Collection properties**:
- `DAV:resourcetype` — `<D:collection/>` + `<C:calendar/>` or `<A:addressbook/>`
- `DAV:displayname` — from `displayName`
- `DAV:getlastmodified` — from `updatedAt` as RFC 1123
- `DAV:sync-token` — opaque token encoding `synctoken`
- `CALDAV:calendar-description` / `CARDDAV:addressbook-description` — from `description`
- `CALDAV:supported-calendar-component-set` — from `supportedComponents`
- Dead properties — deserialize `clientProperties` JSONB as `IrDeadProperties` and emit each
  entry's `xmlValue` under its Clark-notation name. If a client requests a specific dead
  property by name, look it up in the map; if absent, include it in the 404 propstat block.

**Instance properties**:
- `DAV:resourcetype` — empty (leaf resource)
- `DAV:getetag` — from `etag`, wrapped in double-quotes
- `DAV:getcontenttype` — from `contentType`
- `DAV:getlastmodified` — from `lastModified` as RFC 1123
- Dead properties — same as collections: deserialize `clientProperties` from `dav_instance`.

**Test files** (written alongside the code):

`src/http/dav/xml/multistatus.unit.test.ts`:
- Produces valid 207 XML with correct DAV namespace declarations
- Splits found and not-found properties into separate propstat blocks

`src/http/dav/methods/propfind.unit.test.ts`:
- `Depth: 0` on a collection returns only the collection response
- `Depth: 1` on a collection returns the collection plus one response per instance
- `Depth: 0` on an instance returns the instance response
- `Depth: infinity` returns 403 with `DAV:propfind-finite-depth`
- A requested property not present on the resource appears in the 404 propstat block
- Dead properties stored in `clientProperties` are included in the response
- Missing `Depth` header defaults to 0
- `new-collection` and `new-instance` path kinds return 404

---

### Step 9 — PUT handler

**File**: `src/http/dav/methods/put.ts`

Requirements type: `InstanceService | EntityRepository | ComponentRepository | AclService`

Logic:

1. Reject `kind: "collection"` and `kind: "principal"` with 405.
2. `AclService.check(principalId, resourceUrl, "DAV:write-content")`.
3. Read `Content-Type` header. Accept only `text/calendar` or `text/vcard`. Reject others with
   415 + `CALDAV:supported-calendar-data` or `CARDDAV:supported-address-data`.
4. Read body as text (`await req.text()` — web standard, allowed at the HTTP edge).
5. Parse into `IrDocument` via `decodeICalendar` or `decodeVCard`.
6. Extract `logicalUid` via the appropriate `extractUid`.
7. Serialize canonical form via `encodeICalendar` or `encodeVCard` (this is what clients
   will receive on GET).
8. Compute ETag: `SHA-256` of the canonical UTF-8 bytes → hex string, wrapped in quotes.
9. Handle `If-Match` / `If-None-Match` for conditional PUT.
10. Dispatch on `path.kind`:
    - `new-instance`:
      1. `EntityRepository.insert({ entityType, logicalUid })`
      2. `ComponentRepository.insertTree(entityId, ir.root)` — persists full component/property tree
      3. `InstanceService.put({ collectionId, entityId, contentType, etag, slug })`
      4. Return `201 Created` with `ETag` header.
    - `instance`:
      1. `InstanceService.findById(instanceId)` → get `entityId`
      2. `ComponentRepository.deleteByEntity(entityId)` — remove old content
      3. `EntityRepository.updateLogicalUid(entityId, logicalUid)`
      4. `ComponentRepository.insertTree(entityId, ir.root)` — persist new content
      5. `InstanceService.put(input, instanceId)` — update ETag + `syncRevision`
      6. Return `204 No Content` with `ETag` header.

Note: `cal_index` and `card_index` population (for REPORT query support) should happen here too
since the fully parsed IR is available. This can be extracted into a separate indexing helper
used by PUT. Defer if it complicates the initial implementation — REPORT is out of scope for
this phase — but structurally it belongs here.

**Test file** (written alongside the code):

`src/http/dav/methods/put.unit.test.ts`:
- Creates a new instance from valid iCalendar, returns 201 with ETag
- Creates a new instance from valid vCard, returns 201 with ETag
- Updates an existing instance, returns 204 with a new ETag
- ETag changes between two PUTs of different content
- Rejects wrong content type with 415
- Rejects structurally invalid iCalendar with 400 + `CALDAV:valid-calendar-data`
- Rejects structurally invalid vCard with 400 + `CARDDAV:valid-address-data`
- `If-Match` mismatch returns 412
- `If-None-Match: *` on an existing resource returns 412
- Returns 405 for `kind: "collection"` and `kind: "principal"`

---

### Step 10 — GET/HEAD handler

**File**: `src/http/dav/methods/get.ts`

Requirements type: `InstanceService | ComponentRepository | AclService`

Logic:

1. Accept only `kind: "instance"`. Return 405 for all other path kinds.
2. `AclService.check(principalId, resourceUrl, "DAV:read")`.
3. `InstanceService.findById(instanceId)` → get `entityId`, `contentType`, `etag`, `lastModified`.
4. `ComponentRepository.loadTree(entityId)` → `Option<IrComponent>`. Fail with `InternalError`
   if `None` (valid instance must have content).
5. Reconstruct `IrDocument` from the loaded tree and `contentType`.
6. Serialize to text via `encodeICalendar` or `encodeVCard`.
7. For `HEAD`: return headers only, omit body.
8. Return `200 OK` with:
   - `Content-Type: <contentType>; charset=utf-8`
   - `ETag: <quoted etag>`
   - `Last-Modified: <RFC 1123>`
   - Body: serialized text.

**Test file** (written alongside the code):

`src/http/dav/methods/get.unit.test.ts`:
- Returns serialized iCalendar content with correct Content-Type, ETag, and Last-Modified headers
- Returns serialized vCard content with correct Content-Type header
- ETag on GET matches the ETag returned by the preceding PUT
- `HEAD` returns the same headers as GET but with no body
- Returns 405 for `kind: "collection"`, `kind: "principal"`, and `kind: "new-instance"`

---

### Step 11 — Wire up requirements in the router

Expand `DavServices` in `src/http/dav/router.ts` to include
`EntityRepository | ComponentRepository | AclService`. The type-checker will confirm all
requirements are satisfied by `AppLayer`.

---

## Dependency order

```
Step 1  (IR schemas)
Step 1b (content-line codec + tests)       — depends on Step 1
Step 1c (component-tree codec + tests)     — depends on Step 1b

Steps 2 and 3 can be worked in parallel once 1–1c are done:
  ├─ Step 2 (iCalendar codec + tests)      — depends on Steps 1b, 1c
  └─ Step 3 (vCard codec + tests)          — depends on Steps 1b, 1c

Step 4 (entity/component repos + integration tests)  — depends on Step 1
Step 5 (ACL stub + unit test)                        — no dependencies
Step 6 (path types + router tests)                   — no dependencies

Steps 4, 5, 6 can be worked in parallel once Step 1 is done.

Once 1–6 are done:
  ├─ Step 7  (MKCOL + unit tests)    — needs path types + CollectionService + AclService
  ├─ Step 8  (PROPFIND + unit tests) — needs path types + Collection/InstanceService + AclService
  ├─ Step 9  (PUT + unit tests)      — needs path types + IR + repos + codecs + AclService
  └─ Step 10 (GET + unit tests)      — needs path types + IR + ComponentRepository + codecs + AclService

Step 11 (router wiring)  — needs all handlers
```

---

## Explicitly deferred

- `cal_index` / `card_index` population (the IR is available at PUT time; hook it in later for REPORT)
- WebDAV locking (`LOCK`, `UNLOCK`)
- `COPY`, `MOVE`, `DELETE`
- The real `AclDomainLayer` (allow-all stub is explicitly temporary)
- `PROPPATCH` / dead property management
- Sync tokens (`DAV:sync-collection` REPORT, RFC 6578)
- CalDAV scheduling (inbox/outbox, `SCHEDULE:DELIVER`)
- `cal_timezone` handling (store VTIMEZONE on PUT; emit on GET)
