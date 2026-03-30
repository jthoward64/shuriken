# shuriken-ts

A CalDAV/CardDAV server implementation in TypeScript.

## Runtime & Tooling

- **Runtime**: Bun. Use `bun` for all scripts, package management, and test execution.
- **Package manager**: Bun. Never use npm, yarn, or pnpm.
- **TypeScript**: Strict mode. No `any` ever. Use `unknown` and then narrow with runtime checks as needed. 
The only time `any` is allowed is internal to very small functions in order to satisfy *extremely* complex generics.

## Effect

All application logic must use [Effect](https://effect.website) (`effect` package). This means:

- Represent all operations as `Effect<A, E, R>` — never throw, never return bare `Promise`.
- Write logic in small composable functions and effects.
- Write wrappers for external APIs (HTTP, DB, file system) that return `Effect`.
- Model errors as typed tagged unions (e.g. `{ _tag: "NotFound" }`), not raw `Error` subclasses.
- Use `Effect.Service` / `Context.Tag` for dependency injection; never import service implementations directly in business logic.
- Use `Layer` to compose and provide dependencies at the application boundary.
- Prefer `Schema` from `effect` for runtime validation and parsing at system boundaries (incoming requests, DB results).
- Use `Logger` from `effect` for structured logging; never `console.log` in application code.
- Use `FiberRef` or `Span` to propagate request-scoped context (e.g. `requestId`) through the effect system for traceability.
- Use `Effect.gen` for complex effectful logic that would be unwieldy with manual chaining.
- Use `@effect/platform` for filesystem, kv storage, paths, workers, etc.
- Reference: https://effect.website/llms.txt

## HTTP Server

- HTTP server is `Bun.serve`. Only the `fetch` handler is used; we do not use bun's builtin routing as it is not fit for DAV's architectural style.
- Routing is implemented manually in application code.
- Request handlers must return an `Effect` that resolves to a `Response`.

## Bun Isolation

All Bun-specific APIs (file I/O, `Bun.serve`, `Bun.file`, `Bun.password`, etc.) must be wrapped behind interfaces defined in a dedicated platform adapter layer (e.g. `src/platform/`). Business logic and domain code must only depend on these interfaces, not on `Bun.*` globals directly. This makes the codebase portable to Node.js or Deno if needed.

## Database

- ORM: **Drizzle** with a PostgreSQL driver.
- All queries go through Drizzle; no raw SQL strings outside of Drizzle's `sql` template tag.
- Schema is defined in `drizzle/schema/`; keep one concern per file.
- Wrap Drizzle operations in `Effect` (map results, map errors to typed variants).

## Dates and Times

- Use the **Temporal API** for all date/time logic (`Temporal.PlainDate`, `Temporal.ZonedDateTime`, etc.).
- A polyfill is present; do not use `Date`, `Date.now()`, or `new Date()` in application code.
- Store timestamps as timestamptz in the database; parse them back to Temporal objects at the DB boundary (drizzle is configured to return timestamps as strings).

## DAV Entity Identity

- DAV entities (`davCollection`, `davInstance`, etc.) can be addressed by either **slug** or **UUID**.
- **Slugs must be resolved to UUIDs at the edge** (request parsing / routing layer) before entering any business logic.
- All internal code deals exclusively with UUIDs. Never pass a raw slug string into a service or repository function.

## Coding Principles

### Make Invalid State Unrepresentable

- Prefer branded/opaque types and tagged unions over plain strings or numbers for domain concepts (e.g. `CollectionId`, `PrincipalId`, `EntityType`).
- Use `Schema` nominal types or `Brand` from `effect` to distinguish UUIDs of different entity types at the type level.
- Avoid stringly-typed APIs; use enums, union literals, or branded types instead.

### Separation of Concerns

- Layers: **HTTP edge** → **routing** → **service/use-case** → **repository** → **DB**.
- No layer reaches across more than one level.
- Platform-specific code stays in `src/platform/`; domain code has zero Bun/Node/Deno imports.

### DRY

- Extract repeated logic into shared utilities or Effect pipelines.
- Do not duplicate schema definitions; derive types from Drizzle schema or Effect Schema where possible.

### Logging and Traceability

- Use Effect's `Logger` for structured logging — never `console.log` in application code.
- Attach a `requestId` (or trace ID) to every request and propagate it via Effect's `FiberRef` or a `Span`.
- Log at entry and exit of service boundaries with enough context to reconstruct what happened.
- The `dav_shadow` table exists specifically for request/response audit trails; populate it for all inbound and outbound DAV payloads.

## Documentation

- RFC plain-text copies live in `documentation/rfcs/`. Consult these before implementing any DAV/CalDAV/CardDAV behaviour.
- Planning documents live in `documentation/planning/`.
- Key RFCs in scope: 4918 (WebDAV), 4791 (CalDAV), 6352 (CardDAV), 3744 (ACL), 6578 (sync), 5545 (iCalendar), 6350 (vCard), and others in `documentation/rfcs/`.
