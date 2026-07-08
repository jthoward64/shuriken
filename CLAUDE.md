# shuriken-ts

A CalDAV/CardDAV server implementation in TypeScript.

## Agent operations

- If you find what might be a bug, always prompt the user for more information rather than assuming that it is or is not intentional.
- Ask the user for guidance rather than making assumptions.
- Always ask for clarification and additional information as needed before starting to write code.
- When writing code, always follow the coding principles and guidelines outlined in this document, and ask for feedback and review from the user to ensure that the code meets their expectations and requirements.
- If you encounter a situation where the requirements are unclear or conflicting, ask the user to help prioritize and clarify the requirements before proceeding.
- While planning, make notes of alternatives considered and why they were rejected, prompt the user if a decision needs to be made

## Runtime & Tooling

- **Runtime**: Deno. Use `deno` for all scripts, dependency management, and test execution.
- **Dependencies**: declared in `deno.json` as an imports map using `npm:` / `jsr:` specifiers; resolved into `node_modules` via `deno install` (`nodeModulesDir: "auto"`). Never use npm, yarn, pnpm, or bun. There is no `package.json`.
- **Module specifiers**: relative and `#src/*` imports must carry explicit `.ts` extensions — Deno requires them.
- **Tasks**: defined in `deno.json`, run via `deno task <name>`: `start`, `dev`, `docker:start` (migrate then start), `test` (all tests), `test:unit` (`*.unit.test.ts` only, no DB needed), `test:integration` (`*.integration.test.ts`, loads `.env`), `check` (`deno check src/`), `lint`/`format`/`fix` (Biome), `verify` (`check` + Biome `check` — run this before considering work done), `migrations:gen`/`migrations:run` (drizzle-kit), `db:reset`/`db:seed`, `studio` (drizzle-kit studio), `ui:css` (Tailwind build), `hooks` (installs the `.husky` git hooks path).
- **TypeScript**: Strict mode (plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`). No `any` ever. Use `unknown` and then narrow with runtime checks as needed. The only time `any` is allowed is internal to very small functions in order to satisfy *extremely* complex generics.
- **Biome**: Use Biome (`biome.json`) for linting and formatting, pinned via `npm:@biomejs/biome@2.4.9`. Warnings, errors, and infos should all be fixed. Prefer using Biome's autofix features (`deno task fix`) where possible, but feel free to make manual adjustments as needed. Disabling or ignoring lint rules requires express approval from the user.

## Effect

All application logic must use [Effect](https://effect.website) (`effect` package, currently pinned to the `4.0.0-beta` line — `npm:effect@4.0.0-beta.88` — see also `@effect/platform-node`, `@effect/sql-pg`, `@effect/sql-pglite` at the same version). This means:

- Represent all operations as `Effect<A, E, R>` — never throw, never return bare `Promise`.
- Write logic in small composable functions and effects.
- Write wrappers for external APIs (HTTP, DB, file system) that return `Effect`.
- Model errors as `Data.TaggedError` classes (e.g. `class NotFound extends Data.TaggedError("NotFound")<{ ... }> {}`); never use plain `{ _tag }` object literals or raw `Error` subclasses.
- Use `Context.Service` (the beta-4 DI API) for dependency injection; never import service implementations directly in business logic. (`Effect.Service` and `Context.Tag` are not used in this codebase — some XML helper files even have a comment noting they're deliberately *not* an `Effect.Service`.)
- Use `Layer` to compose and provide dependencies at the application boundary (see `src/layers.ts` for the top-level `AppLayer`).
- Prefer `Schema` from `effect` for runtime validation and parsing at system boundaries (incoming requests, DB results). In practice most service/repository interfaces are still plain `Context.Service` shapes rather than `Schema`-derived — reach for `Schema` at true external boundaries (HTTP bodies, DB rows) rather than internal service contracts.
- Use `Logger` from `effect` for structured logging; never `console.log` in application code.
- Use `FiberRef` or `Span` to propagate request-scoped context (e.g. `requestId`) through the effect system for traceability. Current usage is narrow (`FiberRef` in `src/services/component/repository.live.ts` and `src/http/smtp-headers-ref.ts`; `withSpan` in a handful of files) — there is no single `requestId` `FiberRef` threaded through every request yet. Follow the rule for new code; don't treat existing narrow usage as the ceiling.
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
  - Note: a lot of existing code (e.g. `src/startup.ts`, `src/services/scheduling/service.live.ts`, `src/http/dav/router.ts`) still uses manual `isSome`/`isNone` guard clauses. That's legacy debt, not the target style — prefer combinators in new and touched code, and refactor to combinators opportunistically when editing nearby code.
- Reference: index of docs available at https://effect.website/llms.txt and a complete API reference at https://effect-ts.github.io/effect/docs/effect or node_modules/effect/dist/dts/...

## Web UI

- The web UI has migrated off Handlebars: pages are now typed **JSX/TSX components** (`preact`, server-rendered via `preact-render-to-string`, see `src/http/ui/view/render.tsx`) rendered inside `Effect`. There is no client-side hydration — components render to static HTML.
- Interactivity is added progressively with **HTMX**. Handlers detect HTMX requests (`isHtmxRequest`, `src/http/ui/helpers/htmx.ts`) and return just the content fragment instead of the full `Layout`-wrapped page.
- Styling is plain **Tailwind CSS** (`npm:tailwindcss`), built via `deno task ui:css` (`scripts/build-css.ts`). TW Elements is no longer used/referenced in the codebase — don't reintroduce it without checking with the user first.
- A couple of legacy files still reference `handlebars`/`.hbs` (`src/http/ui/css/service.live.ts`, `src/http/ui/helpers/acl-panel.ts`) — treat these as remnants, not the current pattern, when touching that area.
- HTMX docs are available at https://four.htmx.org/reference
- The UI should be progressively enhanced and functional without JavaScript where possible, but can use HTMX for dynamic interactions.
- The UI should use the same DAV APIs as external clients, rather than having separate endpoints or logic for the web UI. This ensures consistency and reduces the amount of code we have to maintain.
- The UI should be designed with accessibility in mind, using semantic HTML and ARIA attributes as needed to ensure it is usable by all users.
- Components should be reusable and composable where possible (see `src/http/ui/view/`), to avoid duplication and make it easier to maintain the UI codebase.

## HTTP Server

- HTTP server is `Deno.serve`. Only the `fetch` handler is used; we do not use any builtin routing as it is not fit for DAV's architectural style. The handler resolves the client IP from the connection info and passes it (not any transport object) into `handleRequest`.
- Routing is implemented manually in application code.
- Request handlers must return an `Effect` that resolves to a `Response`.
- The actual request data should not be accessed in any code outside the http edge (e.g. services, repositories). Parse and validate all request data at the edge and convert to well-defined types before passing into business logic (this includes the url path, query parameters, headers, body, etc.).
- Response construction should also happen at the edge; service and repository functions should return well-defined types or tagged unions, not raw `Response` objects. We should be able to up and switch to literally any transport without touching business logic.

## Runtime Isolation

All runtime-specific APIs (`Deno.*` for sockets/serve, `node:*` for file I/O, password hashing, etc.) must be wrapped behind interfaces defined in a dedicated platform adapter layer (`src/platform/`, currently `crypto.ts` and `file.ts`). Business logic and domain code must only depend on these interfaces, not on `Deno.*`/`node:*` directly. This keeps the codebase portable to Node.js or Bun if needed. Web standard APIs (`fetch`, `Request`, `Response`, `URL`, `crypto`, `TextEncoder`, etc.) can be used directly in application code as they are universally available. Password hashing uses argon2id/argon2Verify via `hash-wasm` (portable WASM), PHC-formatted hashes, OWASP-recommended params (64MiB/t=3/p=1), behind `CryptoService`/`CryptoServiceLive` in `src/platform/crypto.ts`.

Note: `Deno.serve` itself is called directly in `src/index.ts` rather than through a `src/platform/` wrapper — the isolation boundary is currently scoped to crypto and file I/O, not the server bootstrap. Flag this to the user before assuming it needs fixing; it may be an intentional scope decision.

## Database

- ORM: **Drizzle**, via **`drizzle-orm/effect-postgres`** (`PgDrizzle.makeWithDefaults({ relations })`) layered over **`@effect/sql-pg`**'s `PgClient`, wired as an Effect `Layer`/`Context.Service` in `src/db/client.ts`. This superseded the older plain `drizzle-orm/postgres-js` + `drizzle({ client, schema })` construction — don't reintroduce that pattern. The relational API is driven by a `relations` object (`src/db/drizzle/relations.ts`), not a `schema` object.
  - The raw `postgres` npm package is still declared in `deno.json` (a transitive dep of `@effect/sql-pg`) but is not imported directly anywhere in `src/`.
  - The plain `postgres({ client, schema })` pattern does still show up in test setup (`src/testing/pglite.ts`, using PGlite for test migrations) — that's a test-only concern, not the production client shape.
- All queries go through Drizzle; no raw SQL strings outside of Drizzle's `sql` template tag.
- Schema is defined in `src/db/drizzle/schema/`, one file per concern (e.g. `acl.ts`, `auth.ts`, `cal.ts`, `card.ts`, `dav.ts`, `principal.ts`, `user.ts`, `groups.ts`, `session.ts`, `share-link.ts`, `oidc-login.ts`, `email-credential.ts`, `external-calendar.ts`, `bulk-job.ts`, `types.ts` for shared codecs) plus an `index.ts` that re-exports them for Drizzle's schema wiring.
- Migrations live in `src/db/drizzle/migrations/` (timestamped directories), managed by drizzle-kit via `drizzle.config.ts`: `deno task migrations:gen` to generate, `deno task migrations:run` to apply.
- Wrap Drizzle operations in `Effect` (map results, map errors to typed variants).

## Dates and Times

- Use the **Temporal API** for all date/time logic (`Temporal.PlainDate`, `Temporal.ZonedDateTime`, etc.).
- The polyfill is **`temporal-polyfill`**, loaded globally via `import "temporal-polyfill/global"` (see `src/index.ts`, `src/domain/ids.ts`). `@js-temporal/polyfill` also appears in a small number of files (3) — prefer `temporal-polyfill` for new code and consolidate onto it if you touch those files. `rrule-temporal` is used for RRULE handling.
- Do not use `Date`, `Date.now()`, or `new Date()` in application code. **Known violation to be aware of**: `src/data/icalendar/recurrence/recurrence-check.ts` currently converts `Temporal` instants to `Date` at a couple of call sites, likely to satisfy an RRULE library's API boundary — flag this to the user before changing it, don't assume it's accidental debt vs. a deliberate interop shim.
- Store timestamps as timestamptz in the database; parse them back to Temporal objects at the DB boundary via custom codecs in `src/db/drizzle/schema/types.ts` (`timestampTz`, `timestampStr`). Note these codecs explicitly handle both `string` and `Date` driver values (`fromDriver(value: Date | string)`) — the underlying `@effect/sql-pg` driver does not guarantee raw-string-only delivery the way the old `drizzle-orm/postgres-js` "transparent parser" setup did, so don't assume the value is always a string without checking.

## XML

- JS doesn't deal with XML well, so we parse XML using fast-xml-parser (`src/http/dav/xml/parser.ts`, `builder.ts`) and then do things like validation, etc.
- This is wrapped as plain `Effect`-returning functions (`parseXml`, `readXmlBody`), not an `Effect.Service`/`Context.Service` — the parser/builder have no dependencies worth injecting, so they're deliberately kept as free functions using `Effect.try`/`Effect.tryPromise`, mapping failures to `XmlParseError`/`DavError`.
- Clark-notation namespacing lives in `src/http/dav/xml/clark.ts`; multistatus response building in `src/http/dav/xml/multistatus.ts`; namespace constants in `src/http/dav/xml/ns.ts`.

## DAV Entity Identity

- DAV entities (`davCollection`, `davInstance`, etc.) can be addressed by either **slug** or **UUID**.
- **Slugs must be resolved to UUIDs at the edge** (request parsing / routing layer) before entering any business logic.
- All internal code deals exclusively with UUIDs. Never pass a raw slug string into a service or repository function.

## DAV URL and href policy

- Both slug-based and UUID-based paths are accepted for every DAV resource; slugs are resolved to UUIDs inside `parseDavPath` (`src/http/dav/router.ts`) before any handler sees them.
- `ResolvedDavPath` (`src/domain/types/path.ts`) is a discriminated union keyed by `kind` (`"wellknown" | "root" | ...`), not a single flat shape — each variant carries its own fields, but the relevant ones still carry the URL-decoded path segments exactly as the client sent them (principal/collection/instance) alongside resolved UUID fields. Handlers use the seg fields when constructing hrefs so that response URLs mirror what the client used.
- **Response `<href>` construction** (priority: satisfy the client; prefer UUIDs only where they don't):
  - For a resource the client directly addressed (depth:0), the href uses the seg values from the path (slug or UUID, whatever the client sent).
  - For **member-enumeration** responses — depth:1 PROPFIND members, and the `calendar-query` / `addressbook-query` / `sync-collection` REPORTs — each member href uses the resource's **stored slug** (falling back to its UUID only if the slug is empty). Clients (e.g. python-caldav) match list/search/sync results against the URL they created the resource at, so the href must mirror that slug. Both slug and UUID still resolve on input, so this never breaks subsequent per-resource requests.
  - `calendar-multiget` / `addressbook-multiget` mirror the request href verbatim.
  - Member-href slugs are percent-encoded via `encodeSegment` (`src/http/dav/encode-segment.ts`) because object names may contain `@` etc. (see `isValidInstanceSlug`).
  - **Link-reference** properties that clients merely follow rather than match — `calendar-home-set`, `addressbook-home-set`, `principal-URL`, `current-user-principal`, `owner`, `schedule-inbox-URL`/`schedule-outbox-URL`, `schedule-default-calendar-URL`, `group-membership` — keep UUID-based hrefs (stable, and the client never compares them to a creation URL).
  - MKCOL/MKCALENDAR/MKADDRESSBOOK `Location` headers: the principal seg is mirrored from the request, and the new collection's slug is used (since that is what the client named it).

## Repository Layout

Top level: `src/` (app code), `documentation/rfcs/` (RFC/spec reference material only — see Documentation section), `scripts/` (CSS build, DB reset/seed), `docker/` + `helm/` (deployment), `external-test-suite/` (litmus, caldav-server-tester, python-caldav conformance suites run against a live server), `TODO.md` (planning notes). Entry points: `src/index.ts` (`Deno.serve` bootstrap), `src/startup.ts` (auth/startup tasks, e.g. first-boot admin password), `src/config.ts` (`AppConfigService`/`AppConfigLive`), `src/layers.ts` (top-level `AppLayer` composition).

### `src/http/` — HTTP edge and routing
- `router.ts` — top-level dispatch to the DAV/UI/feed/metrics/timezones sub-routers; also `context.ts`, `cookie.ts`, `forwarded-url.ts`, `trusted-proxy.ts`, `status.ts`, `smtp-headers-*.ts` (shared HTTP utilities).
- `src/http/dav/` — the WebDAV/CalDAV/CardDAV protocol engine. `router.ts` (dispatch + `parseDavPath`), `encode-segment.ts`; `methods/` has one file per HTTP verb (`propfind.ts`, `proppatch.ts`, `mkcol.ts`, `get.ts`, `delete.ts`, `copy.ts`/`copy-move.ts`, `move.ts`, `options.ts`, `acl.ts`, `instance-props.ts`) plus `report.ts` + `report/sync-collection.ts` (RFC 6578 sync-collection, calendar-query/addressbook-query); `methods/groups/` holds group-specific PROPFIND/PROPPATCH/MKCOL/member-put/member-delete; `xml/` holds the parser/builder (see XML section above), `clark.ts` (Clark-notation namespacing), `multistatus.ts`, `ns.ts`. Tests for this area live in `src/http/dav/__tests__/`.
- `src/http/ui/` — the web UI (see Web UI section). `handlers/` — one subdir per feature (auth, calendar, contacts, collections, groups, feeds, instances, profile, subscriptions, tasks, trash, users); `api/` — JSON API endpoints mirroring the handlers (incl. `acl/`); `view/` — JSX/TSX templates (`layout.tsx`, `nav.tsx`, `ui.tsx`, `render.tsx`, `pages/`); `client/` — client-side JS bundled at build time (`calendar.client.ts`, `reorder.client.ts`, `compile.ts`); `css/`/`styles/`/`static/` — Tailwind + static assets; `page-cache/` — response caching.
- `src/http/feed/`, `src/http/metrics/`, `src/http/timezones/` — small single-purpose routes (iCal feed export, Prometheus metrics, timezone data).

### `src/auth/` and related services — authentication
- `src/auth/` — `service.ts`, `layers/basic.ts`, `layers/single-user.ts`, `layers/composite.ts` (the `CompositeAuthLayer`, see Auth section).
- `src/services/oidc/` — `service.ts`/`service.live.ts`, `map-user.ts` (identity linking), `role-mapping.ts`, `error.ts`.
- `src/services/session/` — session/token management: `token.ts`, `repository.ts`, `oidc-login-repository.ts`, `cleanup.live.ts`.

### `src/services/` — one directory per domain aggregate
Each generally follows a `service.ts`/`service.live.ts` + `repository.ts`/`repository.live.ts` pattern. Notable ones beyond auth/session above:
- `acl/` — WebDAV ACL (RFC 3744), incl. an `allow-all` permissive-mode implementation.
- `scheduling/` and `imip/` — CalDAV Scheduling (RFC 6638) / iTIP: outbound message building and dispatch, inbound handling via an LMTP server (`imip/lmtp-server.ts`, `lmtp-protocol.ts`) for receiving iMIP mail, `event-hook.ts`.
- `principal`, `collection`, `entity`/`component`/`domain-entity` (generic CalDAV/CardDAV object storage), `cal-index`/`card-index` (query indexes), `card-merge`/`contact-merge`, `contact-cleanup`, `group`, `user`, `role`, `provisioning`, `share-link`, `app-password`, `email-credential`, `external-calendar`, `feed`, `birthday`, `bulk-job`, `tombstone`, `trash`, `mailer`, `timezone`, `instance`.

### Other top-level `src/` directories
- `src/data/` — format codecs, protocol-agnostic: `icalendar/` (RFC 5545 + `recurrence/` RRULE engine, `freebusy.ts`, `timezone.ts`), `vcard/` (RFC 6350 + `vcard21.ts` legacy support), shared `component-tree.ts`, `content-line.ts`, `ir.ts` (intermediate representation), `etag.ts`.
- `src/db/` — see Database section: `client.ts`, `query.ts`, `transaction.ts`, `drizzle/schema/`, `drizzle/migrations/`, `drizzle/relations.ts`.
- `src/domain/` — core domain types/errors: `errors.ts`, `ids.ts`, `calendar-color.ts`, `virtual-resources.ts`; `types/` (`calendar.ts`, `contact.ts`, `dav.ts`, `path.ts`, `collection-namespace.ts`, `strings.ts`).
- `src/platform/` — runtime isolation layer (see Runtime Isolation section): `crypto.ts`, `file.ts`.
- `src/observability/` — `metrics.ts`, `prometheus.ts`.
- `src/testing/` — test helpers/fixtures: `pglite.ts` (PGlite-backed test DB), `factories.ts`, `env.ts`, `__fixtures__/dav-gists/`, `script-runner/`.

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
- Platform-specific code stays in `src/platform/`; domain code has zero `Deno.*`/`node:*` runtime imports.

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
  - Most `src/services/*/index.ts` files are *not* barrels despite the name — they double as Effect Layer-composition modules (pre-wired `*DomainLayer` constants) alongside re-exports, which is the intended pattern, not a violation.
  - `src/domain/types/index.ts` is a genuine pure re-export barrel with no Layer logic — this is a known violation of this rule; flag it to the user before assuming it should just be deleted, since callers may depend on the aggregated import path.
  - `src/db/drizzle/schema/index.ts` re-exports all schema files for Drizzle's schema-object wiring — this is required by Drizzle's API shape, not a violation.
- Many small files over fewer large ones; keep well defined boundaries between modules and codebase areas
- **Always prefer refactoring when it improves code quality**

## Documentation

- RFC plain-text copies live in `documentation/rfcs/`. Consult these before implementing any DAV/CalDAV/CardDAV behaviour.
- There is currently no `documentation/planning/` directory — planning/TODO-style notes live in `TODO.md` at the repo root instead. If you create planning documents, ask the user where they'd like them kept before assuming `documentation/planning/`.
- Key RFCs in scope: 4918 (WebDAV), 4791 (CalDAV), 6352 (CardDAV), 3744 (ACL), 6638 (scheduling/iTIP), 6578 (sync), 5545 (iCalendar), 6350 (vCard), and others in `documentation/rfcs/`.
- An index with descriptions and a dependency map is at `documentation/rfcs/index.md`.

## Testing

- **Test runner**: Deno's built-in test runner. `deno task test` runs everything; `deno task test:unit` runs only `*.unit.test.ts` (no `.env`/DB needed); `deno task test:integration` runs only `*.integration.test.ts` (loads `.env`). Tests use `describe`/`it`/`beforeAll` from `@std/testing/bdd` and `expect` from `@std/expect`. Never use Jest, Vitest, Bun's runner, or any other runner.
- Test files live alongside the code they test, named `*.unit.test.ts` or `*.integration.test.ts` — there are no plain `*.test.ts` files in the repo, this naming is enforced everywhere including files under `__tests__/` folders (e.g. `src/http/dav/__tests__/`).

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

- Design all services with an interface (`Context.Service`) and at least one test implementation from the start.
- Avoid side effects in constructors or module-level code; initialize everything through Effect so tests can control lifecycle.
- Prefer small, focused tests over large scenario tests; a failing test should point directly to the broken unit.
- Test files should be named `{name}.{type}.test.ts` (e.g. `user/repository.integration.test.ts` would be an integration test for the user repository).

## Auth

- There are three auth methods: single-user, basic auth, and OIDC.
- Single-user mode is a special mode where auth is disabled and all requests are treated as a single user (set `AUTO_LOGIN`). This is useful for development and testing.
- Basic auth requires a username and password to be sent with each request. The server validates the credentials against the `auth_user` table and identifies the user. Two credential kinds are accepted: `local` (a password set in-app, matched by the username) and `app_password` (a per-device secret matched by the owner's principal slug **or** the credential's generated username).
- OIDC drives the web UI: the browser runs the authorization-code (PKCE) flow against the configured provider (`OIDC_*` config) and the server issues an opaque, DB-backed session cookie. Identities are keyed by `<issuer>|<sub>` in `auth_user`, linked to an existing user by verified email or auto-provisioned on first login. DAV clients never do OIDC — OIDC users generate **app passwords** (managed at `/ui/profile/app-passwords`) to connect their CalDAV/CardDAV clients over Basic auth.
- Optional OIDC role sync: when `OIDC_GROUPS_CLAIM` (an ID-token array claim) and `OIDC_ROLE_MAP` (JSON group→role) are both set, the user's `role` is re-applied from the IdP on every login (highest-privilege match wins; no match → default role). See `src/services/oidc/role-mapping.ts`.
- The composite auth layer runs, in order: AUTO_LOGIN → session cookie → Basic auth. Session validation is a method inside `CompositeAuthLayer`; the OIDC login/callback/logout routes live at the UI edge (`/ui/auth/*`).
- `TRUSTED_PROXIES` is **not** an auth method — it gates `X-Forwarded-*` URL reconstruction and SMTP credential override headers (see `src/http/trusted-proxy.ts`).
- (Proxy auth, where a reverse proxy injected an `X-Remote-User` header, was removed in favour of OIDC.)
