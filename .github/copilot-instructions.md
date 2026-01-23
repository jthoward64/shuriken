# Shuriken: Copilot Instructions

## Project Overview

**Shuriken** is a CalDAV/CardDAV server implementation in Rust. It provides calendar and contact synchronization with the following core features:

- **Postgres backend** for persistent data storage
- **Public .ics URL subscriptions** to allow external calendar access
- **Public .ics URL sharing** for distributing calendars and contacts
- **User and group sharing** for collaborative calendar/contact management

## Architecture Principles

### Module Organization

- `src/component/` contains internal service logic and domain models
- `src/app/` handles HTTP API routing and request/response handling
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

#### Schema & Migrations

- **Schema source of truth**: The auto-generated schema in `src/app/db/schema/mod.rs` is always the most up-to-date representation of the database structure
- **Migration style**: Write migrations with SQL comments that document tables and columns—these comments are preserved by Diesel and appear in the generated schema
- **UUID v7 IDs**: All primary keys use PostgreSQL 17's native `uuidv7()` function for time-ordered, globally unique identifiers
- **Naming**: Use `snake_case` for all table and column names
- **Timestamps**: Don't add `created_at` columns—use `uuid_extract_timestamp(id)` to get creation time from UUID v7. Only include `updated_at` when modification tracking is needed

**Example migration pattern:**
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

fn by_id(id: i32) -> BoxedQuery<'static> {
    all().filter(users::id.eq(id)).into_boxed()
}

// Usage: compose further
let user = by_id(42).inner_join(profiles::table).select(...).first(conn)?;
```

```rust
// ❌ Avoid: Functions that take connection and execute
fn by_id(id: i32, conn: &mut PgConnection) -> QueryResult<User> {
    users::table.find(id).first(conn)  // Can't reuse or compose
}
```

Use `#[diesel::dsl::auto_type]` to avoid complex explicit return types. Extract SQL expressions into filter functions using `AsExpression` for type flexibility.

### Serialization
- **serde** + **serde_derive**: Serialization/deserialization for config and API payloads
- **quick-xml**: XML parsing for RFC compliance (CalDAV/CardDAV standards)
- **chrono** & **chrono-tz**: Date/time handling with timezone support
- **uuid**: Unique identifiers for resources

### Networking & HTTP
- **reqwest**: HTTP client for making external requests (public .ics subscriptions)
- **ipnetwork**: IP address/network utilities for access control

### Parsing & Configuration
- **pest**: Parser combinator for custom DSL parsing if needed
- **config**: Configuration management from environment variables and files
- **thiserror**: Error type derive macros for component-level error handling

### Quality & Debugging
- **anyhow**: Error context for main application logic
- **tracing**: Structured logging and debugging

## Error Handling Strategy

### Use `anyhow` for:
- Main application flow in `main()` and high-level endpoints
- Wrapping multiple error types where context matters
- User-facing API errors that need rich error context

### Use `thiserror` for:
- Internal component errors with specific error variants
- Errors that get propagated within the service layer
- Define custom error types in `src/component/error/`

**Example:**
```rust
// component/error/mod.rs - Use thiserror
#[derive(thiserror::Error, Debug)]
pub enum DatabaseError {
    #[error("User not found: {0}")]
    UserNotFound(uuid::Uuid),
    #[error("Invalid query")]
    InvalidQuery,
}

// app/mod.rs - Convert to anyhow at API boundary
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

- All database operations are async via diesel-async
- Public .ics URLs should validate access permissions before serving
- Sharing logic must handle both individual users and groups correctly
- Configuration is environment-variable driven; see `src/component/config/mod.rs` for adding new settings
- CalDAV/CardDAV RFC compliance is managed in `src/component/rfc/`
