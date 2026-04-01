# shuriken-ts

A CalDAV/CardDAV server implementation in TypeScript.

## Runtime & Tooling

- **NVM**: Run `nvm use 24` to activate the correct Node version
- **Runtime**: Bun. Use `bun` for all scripts, package management, and test execution.
- **Package manager**: Bun. Never use npm, yarn, or pnpm.
- **Scripts**: bun run `check`, `lint`, `format`, and `test` scripts are defined
- **TypeScript**: Strict mode. No `any` ever. Use `unknown` and then narrow with runtime checks as needed. The only time `any` is allowed is internal to very small functions in order to satisfy *extremely* complex generics.
- **Biome**: Use Biome for linting and formatting. Warnings, errors, and infos should alls be fixed

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
- Functions should *accept* and return Options or Results where appropriate, rather than nullable/undefined values or throwing errors. This keeps consistency in types (we don't have to convert to/from undefined/null/throw at every boundary) and forces handling of edge cases.
- Do not directly access internal properties of Effect objects (e.g. `_tag`, `_A`, `_E`, `_R`); use effect's combinators and utilities to work with them instead. The internal structure of Effect is an implementation detail that may change, and relying on it can lead to brittle code.
- When working with `Option`, always prefer combinators over manual `isSome`/`isNone` + `.value` access:
  - Transform the inner value: `Option.map(opt, f)` instead of `isSome(opt) ? f(opt.value) : Option.none()`
  - Extract with a fallback: `Option.getOrElse(opt, () => default)` instead of `isSome(opt) ? opt.value : default`
  - Extract as nullable: `Option.getOrUndefined(opt)` / `Option.getOrNull(opt)` instead of `isSome(opt) ? opt.value : undefined`
  - Branch on Some/None: `Option.match(opt, { onSome: f, onNone: g })` instead of ternary with `.value`
  - The only acceptable use of `isSome`/`isNone` is when no other options apply (for example mapping the option to a failure case)
- Reference: https://effect.website/llms.txt

## HTTP Server

- HTTP server is `Bun.serve`. Only the `fetch` handler is used; we do not use bun's builtin routing as it is not fit for DAV's architectural style.
- Routing is implemented manually in application code.
- Request handlers must return an `Effect` that resolves to a `Response`.
- The actual request data should not be accessed in any code outside the http edge (e.g. services, repositories). Parse and validate all request data at the edge and convert to well-defined types before passing into business logic (this includes the url path, query parameters, headers, body, etc.).
- Response construction should also happen at the edge; service and repository functions should return well-defined types or tagged unions, not raw `Response` objects. We should be able to up and switch to literally any transport without touching business logic.

## Bun Isolation

All Bun-specific APIs (file I/O, `Bun.serve`, `Bun.file`, `Bun.password`, etc.) must be wrapped behind interfaces defined in a dedicated platform adapter layer (e.g. `src/platform/`). Business logic and domain code must only depend on these interfaces, not on `Bun.*` globals directly. This makes the codebase portable to Node.js or Deno if needed. Web standard APIs can be use directly in application code as they are universally available.

## Database

- ORM: **Drizzle** with a PostgreSQL driver.
- All queries go through Drizzle; no raw SQL strings outside of Drizzle's `sql` template tag.
- Schema is defined in `src/db/drizzle/schema/`; keep one concern per file.
- Wrap Drizzle operations in `Effect` (map results, map errors to typed variants).

## Dates and Times

- Use the **Temporal API** for all date/time logic (`Temporal.PlainDate`, `Temporal.ZonedDateTime`, etc.).
- A polyfill is present; do not use `Date`, `Date.now()`, or `new Date()` in application code.
- Store timestamps as timestamptz in the database; parse them back to Temporal objects at the DB boundary (drizzle is configured to return timestamps as strings).

## XML

- JS doesn't deal with XML well, so we parse XML using fast-xml-parser and then do things like validation, etc.
- This is wrapped in effect using a transform

## DAV Entity Identity

- DAV entities (`davCollection`, `davInstance`, etc.) can be addressed by either **slug** or **UUID**.
- **Slugs must be resolved to UUIDs at the edge** (request parsing / routing layer) before entering any business logic.
- All internal code deals exclusively with UUIDs. Never pass a raw slug string into a service or repository function.

## Coding Principles

### Make Invalid State Unrepresentable

- Prefer branded/opaque types and tagged unions over plain strings or numbers for domain concepts (e.g. `CollectionId`, `PrincipalId`, `EntityType`).
- Use `Schema` nominal types or `Brand` from `effect` to distinguish UUIDs of different entity types at the type level.
- Avoid stringly-typed APIs; use enums, union literals, or branded types instead.
- Parse and validate all external input (HTTP requests, DB results) at the boundary and convert to well-defined types before passing into business logic.
- Types that can have multiple shapes should be tagged unions or take advantage of effect
- String template types are a great tool to avoid the cost of parsing/formatting strings, while still enforcing type safety.

### Separation of Concerns

- Layers: **HTTP edge** → **routing** → **service/use-case** → **repository** → **DB**.
- No layer reaches across more than one level.
- Platform-specific code stays in `src/platform/`; domain code has zero Bun/Node/Deno imports.

### DRY

- Extract repeated logic into shared utilities or Effect pipelines.
- Do not duplicate schema definitions; derive types from Drizzle schema or Effect Schema where possible.
- Do not rely on a string being parsed or created the same way in multiple places; always parse to a well-defined type at the boundary and then work with that type internally, emitting strings only when necessary for output.

### Logging and Traceability

- Use Effect's `Logger` for structured logging — never `console.log` in application code.
- Attach a `requestId` (or trace ID) to every request and propagate it via Effect's `FiberRef` or a `Span`.
- Log at entry and exit of service boundaries with enough context to reconstruct what happened.
- The `dav_shadow` table exists specifically for verifying integrity. It should not be used for any other purpose, and will likely be removed in the future once we know we can trust the codebase.

### Project structure

- No barrel files (they encourage bad import practices and make it easy to accidentally create circular dependencies)
- Many small files over fewer large ones; keep well defined boundaries between modules and codebase areas
- **Always prefer refactoring when it improves code quality**

## Documentation

- RFC plain-text copies live in `documentation/rfcs/`. Consult these before implementing any DAV/CalDAV/CardDAV behaviour.
- Planning documents live in `documentation/planning/`.
- Key RFCs in scope: 4918 (WebDAV), 4791 (CalDAV), 6352 (CardDAV), 3744 (ACL), 6578 (sync), 5545 (iCalendar), 6350 (vCard), and others in `documentation/rfcs/`.

## Testing

- **Test runner**: Bun's built-in test runner (`bun test`). Never use Jest, Vitest, or any other runner.
- Test files live alongside the code they test as `*.test.ts`, or in a `__tests__/` folder next to the module.

### Testability via Effect's Requirements System

- Every service, repository, and use-case must declare all its dependencies as Effect requirements (`R` type parameter) rather than importing concrete implementations.
- This means any dependency (database, HTTP client, clock, file system, etc.) can be substituted by providing a different `Layer` in tests — no monkey-patching, no module mocking.
- Example: a repository that depends on a `DatabaseService` is provided a real `DatabaseLayer` in integration tests and an in-memory `TestDatabaseLayer` in unit tests, with zero changes to the repository code.
- Never use `Effect.provide` with concrete implementations inside business logic; that is the test or application entry point's job.

### Unit Tests

- Provide lightweight in-memory test layers for all services and repositories.
- Test a single unit of logic in isolation; its dependencies should be test doubles supplied via `Layer`.
- Avoid touching the network, file system, or database in unit tests — use test layers instead.
- Use `Effect.runPromise` (or `Effect.runSync` where appropriate) to execute effects under test.

### Integration Tests

- Integration tests may use a real database (test schema / isolated connection) and real infrastructure.
- Use `Layer` composition to wire up real implementations end-to-end.
- Keep integration tests clearly separated from unit tests (e.g. by file name convention `*.integration.test.ts` or a dedicated directory).

### General Guidelines

- Design all services with an interface (Effect `Service` / `Context.Tag`) and at least one test implementation from the start.
- Avoid side effects in constructors or module-level code; initialize everything through Effect so tests can control lifecycle.
- Prefer small, focused tests over large scenario tests; a failing test should point directly to the broken unit.

## Auth

- There are three auth methods: single-user, basic auth, and proxy auth
- Single-user mode is a special mode where auth is disabled and all requests are treated as a single user. This is useful for development and testing.
- Basic auth requires a username and password to be sent with each request. The server validates the credentials and identifies the user.
- Proxy auth is used when the server is behind a reverse proxy that handles authentication. The proxy adds a header (e.g. `X-Forwarded-User`) with the authenticated user's identity, and the server trusts this header to identify the user.
