# Shuriken: Copilot Instructions

## Tool Usage

- When in complex shells like fish, complex cli commands may not work as expected due to escaping issues. In such cases, switch to a simpler shell like bash or sh (with `exec bash` or `exec sh`) first. For one offs you can also use `bash -c 'your command here'` to run a command in bash without switching shells.

## Project Overview

**Shuriken** is a CalDAV/CardDAV server implementation in Rust. It provides calendar and contact synchronization with the following core features:

- **Postgres backend** for persistent data storage
- **Public .ics URL subscriptions** to allow external calendar access
- **Public .ics URL sharing** for distributing calendars and contacts
- **User and group sharing** for collaborative calendar/contact management
- **Casbin-based authorization** for fine-grained access control
- **Principal-based ACL system** for unified identity management

## Compliance Documentation

When making any feature changes or implementing new functionality:
- **Follow the guidelines in** [`documentation/compliance/Maintaining.md`](../documentation/compliance/Maintaining.md) for keeping compliance documentation in sync
- **Refer to** [`documentation/compliance/README.md`](../documentation/compliance/README.md) as the compliance index to quickly locate RFC requirements, implementation patterns, and architectural decisions
- Update the relevant compliance documents when adding features that affect RFC compliance

## Architecture Principles

### Module Organization

- `src/component/` contains internal service logic and domain models
  - `auth/` - Authentication (Casbin) and authorization logic
  - `config/` - Configuration management
  - `db/` - Database connection, schema, queries, and mappings
  - `error/` - Custom error types using thiserror
  - `middleware/` - HTTP middleware (auth, etc.)
  - `model/` - Domain models (user, group)
  - `remote/` - External integrations (holiday, .ics subscriptions)
  - `rfc/` - RFC parsers and validators (DAV, iCal, vCard)
- `src/app/` handles HTTP API routing and request/response handling
  - `api/` - HTTP endpoints organized by protocol (CalDAV, CardDAV, app-specific)
- `src/util/` provides reusable utilities and helpers
- Keep modules focused and single-responsibility
- Break complex logic into smaller, composable functions
- Split files up whenever they grow too large or encompass multiple concerns, more files is better than large files
- There is still a lot of code yet to be written, so keep things flexible and leave room for future growth, keep modules loosely coupled

### Function Design

- Keep functions short and focused (aim for <40 lines when possible)
- Extract sub-logic into separate helper functions rather than nesting deeply
- Use meaningful names that clarify intent
- Document complex logic with clear comments explaining the "why"
- Return early to reduce nesting and improve readability
- Prefer immutable data where possible; use mutable state sparingly
- Global mutable state is the devil, avoid it
- So are drill parameters, prefer keeping state in tight scopes
- Leverage Rust's type system for safety (e.g., enums for state, newtypes for domain concepts)
- Add `#[must_use]` to any functions that return a value and have no side effects, basicaly fucntions where if you don't use the return value there is no point in calling them

### Testability & Side-Effect Isolation

- **Default to pure functions**: parsing, validation, query composition, and response shaping should be pure (inputs → outputs).
- **Isolate side effects** (DB, Casbin, time, randomness/UUIDs, network, filesystem) behind small, discrete APIs.
- **Prefer parameter injection** over reaching into globals:
    - Services should accept `&mut DbConnection<'_>` and an authorizer wrapper (or `impl Authorizer`) as parameters.
    - HTTP handlers are allowed to acquire connections/enforcer wrappers from globals and pass them down.
- **Short functions are testable functions**:
    - Keep functions <40 lines when possible.
    - Split large handlers into: header/body parsing helpers + service call + response serialization.
- **Avoid “hidden I/O” in helpers**:
    - `src/component/db/query/*` must stay pure query composition.
    - `src/component/rfc/*` must not talk to DB or the network.
- **Mock-friendly boundaries**:
    - Introduce tiny “ports” traits where needed (`Authorizer`, `Clock`, `HttpClient`) with production and test implementations.
    - Public traits must express async behavior as `fn ... -> impl Future<Output = ...>` (add `+ Send` when needed).
- **Test strategy**:
    - Unit tests: RFC parsers, validators, header parsing, multistatus building.
    - Integration tests: in-process Salvo `Service` tests and/or real Postgres-backed tests for DB + sync-token/ETag semantics.
- **Logging in Tests**
    - Integration tests have logging enabled via `test_log` crate.
    - Use `#[test_log::test]` attribute on any test functions to capture logs (or `#[test_log::test(tokio::test)]` for async tests).
    - Logs are only output if the test fails unless you pass `-- --nocapture` to `cargo test`.
    - `test_log` supports the RUST_LOG environment variable for log level control (e.g., `RUST_LOG=debug` or `RUST_LOG=shuriken=info`).

## Dependencies & Usage

### Core Async & Runtime
- **tokio**: Async runtime for handling concurrent requests and I/O operations
- **salvo**: Web framework for HTTP API endpoints and request routing

#### Async Traits

Public traits cannot use `async fn` syntax directly. Instead, return `impl Future`:

```rust
// ✅ Good: Public trait with async method
pub trait Seeder {
    fn seed(&self, conn: &mut DbConnection<'_>) -> impl Future<Output = anyhow::Result<()>>;
    // Add `+ Send` if the future needs to be Send-safe:
    // fn seed(&self, conn: &mut DbConnection<'_>) -> impl Future<Output = anyhow::Result<()>> + Send;
}

// Implementation can still use async fn
impl Seeder for MySeeder {
    async fn seed(&self, conn: &mut DbConnection<'_>) -> anyhow::Result<()> {
        // ... async code
    }
}
```

### Database
- **diesel** & **diesel-async**: ORM for type-safe database queries and schema management
  - Manages Postgres connections and async query execution
  - Use diesel's type system to prevent SQL injection
  - Leverage migrations for schema changes
- **diesel-guard**: Additional utilities for Diesel
- **diesel-async-adapter**: Adapter for compatibility between diesel and diesel-async

#### Schema & Migrations

- **Schema source of truth**: The auto-generated schema in `src/component/db/schema.rs` is always the most up-to-date representation of the database structure
- **Migration style**: Write migrations with SQL comments that document tables and columns—these comments are preserved by Diesel and appear in the generated schema
- **UUID v7 IDs**: All primary keys use PostgreSQL 17's native `uuidv7()` function for time-ordered, globally unique identifiers
- **Naming**: Use `snake_case` for all table and column names
- **Timestamps**: Don't add `created_at` columns—use `uuid_extract_timestamp(id)` to get creation time from UUID v7. Only include `updated_at` when modification tracking is needed
- **Auto-updated timestamps**: Use `SELECT diesel_manage_updated_at('table_name');` in migrations to auto-update `updated_at` columns
- **Soft deletes**: Use `deleted_at TIMESTAMPTZ` columns for soft-delete functionality where appropriate (undo window / pending purge)

**Example migration pattern:**
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT diesel_manage_updated_at('users');

COMMENT ON TABLE users IS 'User accounts for the CalDAV/CardDAV server';
COMMENT ON COLUMN users.id IS 'UUID v7 primary key';
COMMENT ON COLUMN users.name IS 'Display name of the user';
```

After running migrations, Diesel automatically updates the schema file with these comments included.

#### Diesel Query Composition Pattern

Extract query logic into small, reusable functions that **return queries or expressions** rather than executing them. This enables composition and reuse:

```rust
// ✅ Good: Returns a query, composable and testable
fn all() -> BoxedQuery<'static> {
    users::table.select(User::as_select()).into_boxed()
}

fn by_id(id: uuid::Uuid) -> BoxedQuery<'static> {
    all().filter(users::id.eq(id)).into_boxed()
}

// Usage: compose further
let user = by_id(user_id).inner_join(profiles::table).select(...).first(conn)?;
```

```rust
// ❌ Avoid: Functions that take connection and execute
fn by_id(id: uuid::Uuid, conn: &mut PgConnection) -> QueryResult<User> {
    users::table.find(id).first(conn)  // Can't reuse or compose
}
```

Use `#[diesel::dsl::auto_type]` to avoid complex explicit return types. Extract SQL expressions into filter functions using `AsExpression` for type flexibility.

**Query Module Organization:**
- Place query composition functions in `src/component/db/query/` organized by domain
- Query functions should be pure and return `BoxedQuery` for flexibility
- Keep query logic separate from models to maintain clean separation of concerns

### Serialization
- **serde** + **serde_derive**: Serialization/deserialization for config and API payloads
- **serde_json**: JSON serialization/deserialization
- **quick-xml**: XML parsing for RFC compliance (CalDAV/CardDAV standards)
- **chrono** & **chrono-tz**: Date/time handling with timezone support
- **uuid**: Unique identifiers for resources (using v7 for time-ordered IDs)

### Internationalization (i18n)
- **icu**: ICU4X for internationalization data and algorithms
  - Use `icu::time::zone::WindowsParser` for Windows timezone ID → BCP-47 timezone mapping
  - Use `icu::time::zone::iana::IanaParserExtended` for IANA timezone canonicalization and alias resolution
  - Use `icu::casemap::CaseMapper::fold_string()` for Unicode case folding (RFC 4790 `i;unicode-casemap` collation)
  - Prefer ICU over handwritten mapping tables for i18n data (timezones, locales, case folding, etc.)

### Networking & HTTP
- **reqwest**: HTTP client for making external requests (public .ics subscriptions)
- **ipnetwork**: IP address/network utilities for access control

### Authorization & Configuration
- **casbin**: Authorization enforcement library for ACL
- **config**: Configuration management from environment variables and files
- **dotenvy**: Load environment variables from .env files

### Parsing & Quality
- **pest**: Parser combinator for custom DSL parsing if needed
- **thiserror**: Error type derive macros for component-level error handling
- **anyhow**: Error context for main application logic
- **tracing** & **tracing-subscriber**: Structured logging and debugging

## Error Handling Strategy

### Use `anyhow` for:
- Main application flow in `main()` and high-level endpoints
- Wrapping multiple error types where context matters
- User-facing API errors that need rich error context

### Use `thiserror` for:
- Internal component errors with specific error variants
- Errors that get propagated within the service layer
- Define custom error types in `src/component/error/mod.rs`

**Example:**
```rust
// component/error/mod.rs - Use thiserror
#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("User not found: {0}")]
    UserNotFound(uuid::Uuid),
    #[error("Invalid query")]
    InvalidQuery,
    #[error("Database error: {0}")]
    DatabaseError(#[from] diesel::result::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

// In components - Use component::error::Result
pub fn get_user(id: uuid::Uuid) -> crate::component::error::Result<User> {
    // ... implementation
}

// app/mod.rs - Convert to anyhow at API boundary if needed
let user = db::get_user(id).map_err(|e| anyhow::anyhow!("DB error: {}", e))?;
```

## Code Style & Quality

### Comments & Documentation

- Use `///` doc comments for public APIs with examples where helpful
- Add inline comments explaining non-obvious logic or important decisions
- Comment WHY code does something, not WHAT it does
- Use `// TODO:` or `// FIXME:` for known limitations or future improvements
- Comments should be markdown formatted with the following sections (each with `##` header level) where applicable:
    - **Summary**: A brief overview of what the code does
    - **Side Effects**: Any important side effects or considerations
    - **Errors**: Possible error conditions and how they are handled
    - **Panics**: Conditions that may lead to panics

**Example:**
```rust
/// ## Summary
/// Creates a new database connection pool.
///
/// ## Errors
/// Returns an error if the pool cannot be created with the provided database URL.
///
/// ## Panics
/// Panics if the provided database URL is invalid.
pub async fn create_pool(database_url: &str, size: u32) -> anyhow::Result<()> {
    // ... implementation
}
```
- Comments should be markdown formatted with the following sections (each with `##` header level) where applicable:
    - **Summary**: A brief overview of what the code does
    - **Side Effects**: Any important side effects or considerations
    - **Errors**: Possible error conditions and how they are handled
    - **Panics**: Conditions that may lead to panics

```
/// ## Summary
/// Describe what the function does and its purpose.
///
/// ## Side Effects
/// Describe any side effects the function may have outside its return value.
///
/// ## Errors
/// Returns an error if the pool cannot be created with the provided database URL.
///
/// ## Panics
/// Panics if the provided database URL is invalid.
```

### Error Cases

When reviewing code:
- Ask: "What happens if this fails?"
- Consider network failures, malformed input, and database errors
- Handle edge cases explicitly rather than panicking
- Use `?` operator for propagating errors; reserve `.unwrap()` only for invariants you're 100% certain about

### Testing Considerations

- Write code that is testable and maintainable
- Consider mocking external dependencies (HTTP calls, DB queries)
- Test error paths, not just happy paths

### Clippy Compliance Guidelines

- Doc formatting: Use backticks around technical terms and protocol names (e.g., `WebDAV`, `CalDAV`, `CardDAV`, `QName`, `ETag`). Use backticks for identifiers and literals in docs.
- Doc sections: For public functions that return `Result`, include a `## Errors` section. For functions that may panic or use `unwrap`/`expect`, include a `## Panics` section with rationale and conditions.
- Avoid manual string patterns: Prefer `strip_prefix`/`strip_suffix` over `starts_with` + slicing. Use `map_or`, `is_some_and`, and similar helpers to simplify common `Option`/`Result` patterns.
- Formatting/append: Use `write!`/`writeln!` instead of repeated `format!` concatenations when building strings.
- Or-patterns: Use unnested or-patterns (`A | B`) rather than duplicating match arms.
- Wildcards in tests: Avoid `_` catch-alls when matching enums with known variants; explicitly list non-target variants to avoid future-variant pitfalls.
- Function length: Keep functions under ~50 lines when possible. Split into helpers for parsing, validation, and serialization to avoid `too_many_lines` lints.
- #[must_use]: Add `#[must_use]` to builder-style methods and pure constructors to signal intent.
- Dead code: During scaffolding, unused items are OK; prefer module-local visibility or feature gates to reduce noise.
- Lint suppression: Prefer `#[expect(clippy::lint_name)]` over `#[allow(clippy::lint_name)]` to document intentional deviations. Use `#[expect]` when the lint is temporarily unavoidable (e.g., complex parsers during scaffolding) but plan to refactor later. Use file-level `#![expect(...)]` for pervasive patterns (e.g., `map_err_ignore` in parser modules where error sources are intentionally discarded until richer error types are implemented).
- Parser complexity: For large parse functions (>50 lines), extract helpers for:
  - Namespace/attribute collection
  - Element-specific parsing logic
  - List/value parsing
  - This keeps the main parse loop readable and each helper testable in isolation.

## Cargo & Verification

- Run `cargo check` after completing major feature changes to catch compile errors early
- Do NOT run `cargo check` after every small edit—it's a verification step, not a development loop
- Run `cargo check --all-targets` to validate tests and examples
- Use `cargo clippy --all-targets` to catch linting issues before committing

## Code Review Checklist

Before considering work done:

- ✅ Does the logic handle error cases gracefully?
- ✅ Are functions and files reasonably sized?
- ✅ Is the code intent clear through naming and comments?
- ✅ Does error handling use the right strategy (anyhow vs thiserror)?
- ✅ Are there any `.unwrap()` calls that should be error handling?
- ✅ Does the change align with the module structure?

## When in Doubt

- **Consult the docs**: Always check the official crate documentation (docs.rs) for APIs you're unfamiliar with
- **Ask for clarification**: If a requirement is ambiguous or you're unsure about implementation approach, ask—don't guess
- **Reference RFCs**: For CalDAV/CardDAV specific behavior, refer to RFC 4791 (CalDAV), RFC 6352 (CardDAV), and related standards
- **Review existing code**: Look at similar patterns in the codebase before introducing new approaches

## Notable Implementation Details

### Database Schema Overview

The database schema is organized into several key areas:

**Core Identity & Access:**
- `user` - User accounts with email and display name
- `auth_user` - External authentication provider mappings (OAuth, LDAP)
- `group` - Organizational groups for collaborative sharing
- `group_name` - Group names and aliases (supports multiple names per group)
- `membership` - Many-to-many relationship between users and groups
- `principal` - Unified principal namespace for ACL subjects (users, groups, system/public/resource principals)
- `casbin_rule` - Casbin authorization rules

**DAV Storage (CalDAV/CardDAV):**
- `dav_collection` - Collections (calendars/addressbooks) owned by principals
- `dav_entity` - Canonical content entity (shared across collection instances)
- `dav_instance` - Per-collection resource instance referencing a canonical entity
- `dav_component` - Component tree for iCalendar/vCard content (e.g., VEVENT, VCARD)
- `dav_property` - Properties for components with typed value columns
- `dav_parameter` - Parameters associated with properties
- `dav_tombstone` - Deletion tombstones for sync correctness after purge
- `dav_shadow` - Debug ONLY shadow storage of inbound/outbound payloads

**Derived Indexes for Queries:**
- `cal_index` - CalDAV query index (time-range, UID lookups, etc.)
- `cal_occurrence` - Occurrence expansion cache for recurring components
- `card_index` - CardDAV query index (FN, UID, full-text search)
- `card_email` - Indexed vCard email addresses
- `card_phone` - Indexed vCard phone numbers

**Key Design Patterns:**
- Entity/Instance separation allows sharing content across multiple collections
- Soft deletes (`deleted_at`) provide undo windows and pending purge functionality
- Monotonic sync tokens and revisions enable efficient client synchronization
- Component tree structure supports nested iCalendar/vCard components
- Typed value columns in `dav_property` ensure deterministic serialization

### Code Organization

**Model Layer** (`src/component/model/`):
- Models use Diesel derives: `Queryable`, `Selectable`, `Identifiable`, `Insertable`, `AsChangeset`
- Separate structs for querying (`User`) and insertion (`NewUser`)
- Models are organized by domain (user, group) with submodules for related entities
- Use `Associations` derive and `#[diesel(belongs_to(...))]` for relationships
- All models check for Postgres backend with `#[diesel(check_for_backend(Pg))]`

**Model Pattern Example:**
```rust
// Query struct
#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = schema::user)]
#[diesel(check_for_backend(Pg))]
pub struct User {
    pub id: uuid::Uuid,
    pub name: String,
    pub email: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub principal_id: uuid::Uuid,
}

// Insert struct
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::user)]
pub struct NewUser<'a> {
    pub name: &'a str,
    pub email: &'a str,
    pub principal_id: uuid::Uuid,
}

// Association example
#[derive(Debug, Identifiable, Queryable, Selectable, Associations)]
#[diesel(table_name = schema::auth_user)]
#[diesel(check_for_backend(Pg))]
#[diesel(belongs_to(User, foreign_key = user_id))]
pub struct AuthUser {
    pub id: uuid::Uuid,
    pub auth_source: String,
    pub auth_id: String,
    pub user_id: uuid::Uuid,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}
```

**Database Layer** (`src/component/db/`):
- `connection.rs` - Pool management using `OnceLock` for global singleton
- `schema.rs` - Auto-generated Diesel schema (never edit manually)
- `query/` - Query composition functions (currently empty, to be populated)
- `map/` - Mapping functions between database and domain models (to be implemented)

**Authentication & Authorization** (`src/component/auth/`):
- `casbin.rs` - Casbin enforcer integration
- `authenticate.rs` - Authentication logic
- `casbin_model.conf` - ReBAC authorization model
- Uses principal-based ACL system for unified identity management
- Flat group model (no nested groups)
- Enforcement expands user to `{user} ∪ groups(user) ∪ {public}` for permission checks
- Supports direct sharing to users, groups, and "public"
- Type-based permissions per resource type (calendar, calendar_event, addressbook, vcard)
- Roles: freebusy, reader, writer, owner
- **Authorization path format**: Casbin policies use **UUID-based paths** (e.g., `/cal/<principal-uuid>/<collection-uuid>/**`), NOT slug-based paths. This ensures policies remain stable even if collection slugs are renamed. Use `RESOLVED_LOCATION` from the depot for authorization checks, not `PATH_LOCATION`. Exception: For handlers that specifically need the original slug (e.g., PUT where the filename matters), use `PATH_LOCATION` only for that purpose, not for authorization.

### Implementation Guidelines

- All database operations are async via diesel-async
- Use `DbPool` and `DbConnection<'pool>` types from `src/component/db/connection.rs`
- Global database pool is initialized once with `create_pool()` and accessed via `connect()`
- Public .ics URLs should validate access permissions before serving
- Sharing logic must handle both individual users and groups correctly via principals
- Configuration is environment-variable driven; see `src/component/config/mod.rs` for adding new settings
- CalDAV/CardDAV RFC compliance is managed in `src/component/rfc/`
