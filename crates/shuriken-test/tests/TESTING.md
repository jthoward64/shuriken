# Test Infrastructure

This document describes the test infrastructure for the Shuriken CalDAV/CardDAV server.

## Overview

The test infrastructure provides utilities for:
- Setting up and tearing down test database state
- Seeding test data (principals, users, collections, entities, instances, components)
- Running integration tests against a test database
- Making HTTP requests to the test Salvo service
- Asserting on HTTP responses and database state

## Test Coverage

### Integration Tests by HTTP Method

| Module | Method | Description | Tests |
|--------|--------|-------------|-------|
| `options.rs` | OPTIONS | WebDAV compliance headers | Allow header, DAV header, compliance levels |
| `get_head.rs` | GET/HEAD | Resource retrieval | Calendar/vCard retrieval, conditional GET, ETag handling |
| `put.rs` | PUT | Resource creation/update | If-Match, If-None-Match, ETag response |
| `delete.rs` | DELETE | Resource deletion | Item deletion, collection deletion, tombstones |
| `propfind.rs` | PROPFIND | Property discovery | Depth 0/1, allprop, propname, known/unknown props |
| `proppatch.rs` | PROPPATCH | Property modification | Set/remove, protected properties, partial success |
| `mkcol.rs` | MKCALENDAR/MKCOL | Collection creation | Calendar/addressbook creation, extended MKCOL |
| `copy_move.rs` | COPY/MOVE | Resource operations | Rename, copy, Destination header |
| `report.rs` | REPORT | Query operations | calendar-query, multiget, sync-collection |

### Test Patterns

- **Happy path tests**: Verify successful operations return correct status codes and content
- **Error cases**: Verify 4xx/5xx responses for invalid requests, missing resources
- **Conditional requests**: Verify If-Match/If-None-Match/If-Modified-Since handling
- **WebDAV compliance**: Verify proper multistatus responses, property handling

## Test Types

### Unit Tests

Unit tests are located alongside the code they test using the `#[cfg(test)]` module pattern. They test individual functions and modules in isolation.

**Running unit tests:**
```bash
cargo test --lib
```

### Integration Tests

Integration tests are located in the `tests/` directory. They test the full application behavior including database interactions and HTTP routing.

**Running integration tests:**
```bash
# Start the test database
docker-compose up -d postgres

# Run migrations
diesel migration run

# Run all integration tests (including ignored ones)
cargo test --test http_integration -- --include-ignored

# Run only non-ignored tests
cargo test --test http_integration
```

## Test Database Setup

### Important: Database Name Requirements

**The test infrastructure has safety measures to prevent accidentally running tests against production databases:**

1. **Database Name**: The database name must be `shuriken_test`. If `DATABASE_URL` contains a different database name, it will be automatically changed to `shuriken_test` with an info log message.

2. **Required Environment Variable**: `DATABASE_URL` must be explicitly set - there is no default value.

**Recommended DATABASE_URL format:**
```
postgres://username:password@host:port/shuriken_test
```

### Using Docker Compose

The easiest way to run tests is using the provided Docker Compose configuration:

```bash
# Start PostgreSQL
docker-compose up -d postgres

# Create test database (if not already created)
docker exec -it $(docker-compose ps -q postgres) psql -U shuriken -c "CREATE DATABASE shuriken_test;"

# Set the database URL (REQUIRED)
export DATABASE_URL=postgres://shuriken:shuriken@localhost:4523/shuriken_test

# Run migrations on test database
diesel migration run

# Run tests
cargo test --test http_integration -- --include-ignored
```

### Using a Custom Database

You can use any PostgreSQL instance for testing:

```bash
# Create a test database (name MUST be shuriken_test)
createdb shuriken_test

# Set the database URL (REQUIRED)
export DATABASE_URL=postgres://username:password@localhost:5432/shuriken_test

# Run migrations
diesel migration run

# Run tests
cargo test --test http_integration -- --include-ignored
```

## Test Helpers

The test infrastructure provides several helper classes and functions:

### TestRequest - HTTP Request Builder

A builder pattern for constructing HTTP requests:

```rust
use crate::integration::helpers::*;

// Simple request
let response = TestRequest::get("/api/caldav/resource.ics")
    .send(service)
    .await;

// With headers and body
let response = TestRequest::put("/api/caldav/collection/event.ics")
    .if_none_match("*")
    .icalendar_body(&sample_icalendar_event("uid@example.com", "Meeting"))
    .send(service)
    .await;

// WebDAV methods
let response = TestRequest::propfind("/api/caldav/collection/")
    .depth("1")
    .xml_body(propfind_allprop())
    .send(service)
    .await;
```

**Available methods:**
- `get(path)`, `head(path)`, `put(path)`, `delete(path)`, `options(path)`
- `propfind(path)`, `proppatch(path)`, `report(path)`
- `mkcol(path)`, `mkcalendar(path)`, `copy(path)`, `move_to(path)`

**Builder methods:**
- `header(name, value)` - Add custom header
- `depth(value)` - Set Depth header
- `if_match(etag)` - Set If-Match header
- `if_none_match(etag)` - Set If-None-Match header
- `destination(uri)` - Set Destination header
- `content_type(mime)` - Set Content-Type header
- `body(bytes)` - Set raw body
- `xml_body(str)` - Set XML body with proper content type
- `icalendar_body(str)` - Set iCalendar body
- `vcard_body(str)` - Set vCard body

### TestResponse - Response Assertions

Chain-able assertions for HTTP responses:

```rust
// Basic assertions
let response = response
    .assert_status(StatusCode::MULTI_STATUS)
    .assert_header_exists("ETag")
    .assert_body_contains("displayname");

// Access response data
let etag = response.get_etag();
let body = response.body_string();
let count = response.count_multistatus_responses();
```

### TestDb - Database Operations

The test infrastructure provides the `TestDb` helper class for database operations:

### Creating a Test Database Connection

```rust
use crate::integration::helpers::TestDb;

let test_db = TestDb::new().await.expect("Failed to create test database");
```

### Truncating Tables

Before each test, truncate all tables to ensure a clean state:

```rust
test_db
    .truncate_all()
    .await
    .expect("Failed to truncate tables");
```

### Seeding Test Data

#### Seeding a Principal

```rust
let principal_id = test_db
    .seed_principal("user", "/principals/alice/", Some("Alice"))
    .await
    .expect("Failed to seed principal");
```

#### Seeding a User

```rust
let user_id = test_db
    .seed_user("Alice", "alice@example.com", principal_id)
    .await
    .expect("Failed to seed user");
```

#### Seeding a Collection

```rust
let collection_id = test_db
    .seed_collection(
        principal_id,
        "calendar",
        "/calendars/alice/personal/",
        Some("Personal Calendar"),
    )
    .await
    .expect("Failed to seed collection");
```

#### Seeding an Entity

```rust
let entity_id = test_db
    .seed_entity("icalendar", Some("event-123@example.com"))
    .await
    .expect("Failed to seed entity");
```

#### Seeding a Component

```rust
// Root component (VCALENDAR)
let vcal_component_id = test_db
    .seed_component(entity_id, None, "VCALENDAR", 0)
    .await
    .expect("Failed to seed VCALENDAR component");

// Child component (VEVENT)
let vevent_component_id = test_db
    .seed_component(entity_id, Some(vcal_component_id), "VEVENT", 0)
    .await
    .expect("Failed to seed VEVENT component");
```

#### Seeding an Instance

```rust
let instance_id = test_db
    .seed_instance(
        collection_id,
        entity_id,
        "/calendars/alice/personal/event-123.ics",
        "text/calendar",
        "\"abc123\"",
        1, // sync_revision
    )
    .await
    .expect("Failed to seed instance");
```

## Example Tests

See `tests/integration/example_test.rs` for complete examples of:
- Seeding a principal
- Creating a full calendar collection hierarchy
- Creating an addressbook collection
- Working with entities, components, and instances

### Sample Data Generators

The helpers module provides functions to generate sample CalDAV/CardDAV data:

```rust
// iCalendar data
let ical = sample_icalendar_event("uid@example.com", "Team Meeting");

// vCard data
let vcard = sample_vcard("John Doe", "john@example.com");

// PROPFIND bodies
let allprop = propfind_allprop();
let propname = propfind_propname();
let specific = propfind_specific_props();

// PROPPATCH body
let proppatch = proppatch_set_displayname("New Name");

// REPORT bodies
let query = calendar_query_report();
let multiget = calendar_multiget_report(&hrefs);
let sync = sync_collection_report_initial();
let sync_delta = sync_collection_report("sync-token-123");

// MKCALENDAR/MKCOL bodies
let mkcal = mkcalendar_body("Work Calendar");
let mkcol_calendar = extended_mkcol_calendar("My Calendar");
let mkcol_addressbook = extended_mkcol_addressbook("My Contacts");
```

## Writing New Tests

### Basic Test Structure

```rust
#[test_log::test(tokio::test)]
#[ignore = "requires running database"]
async fn my_test() {
    // 1. Create test database
    let test_db = TestDb::new().await.expect("Failed to create test database");
    
    // 2. Clean state
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");
    
    // 3. Seed test data
    let principal_id = test_db
        .seed_principal("user", "/principals/test/", Some("Test"))
        .await
        .expect("Failed to seed principal");
    
    // 4. Perform test operations
    // ... your test code here ...
    
    // 5. Assert expected results
    assert!(!principal_id.is_nil());
}
```

### Testing HTTP Endpoints

For HTTP endpoint tests (once routing is fully implemented):

```rust
#[test_log::test(tokio::test)]
#[ignore = "requires HTTP routing"]
async fn test_calendar_propfind() {
    // 1. Set up test database
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db.truncate_all().await.expect("Failed to truncate");
    
    // 2. Seed test data
    let principal_id = test_db.seed_principal("user", "/principals/alice/", Some("Alice")).await.unwrap();
    let collection_id = test_db.seed_collection(
        principal_id,
        "calendar",
        "/calendars/alice/personal/",
        Some("Personal"),
    ).await.unwrap();
    
    // 3. Create test service
    let service = create_test_service();
    
    // 4. Make HTTP request
    let response = TestClient::get("http://127.0.0.1:5800/calendars/alice/personal/")
        .add_header("Depth", "0", true)
        .send(&service)
        .await;
    
    // 5. Assert response
    assert_eq!(response.status_code, Some(StatusCode::MULTI_STATUS));
}
```

## Test Isolation

Each test should:
1. Call `test_db.truncate_all()` at the start to ensure clean state
2. Create its own test data using the seed helpers
3. Not depend on data from other tests
4. Be safe to run in parallel with other tests

## Continuous Integration

Tests are run automatically in CI/CD pipelines. The CI environment:
- Starts a PostgreSQL container
- Runs database migrations
- Executes all non-ignored tests
- Executes integration tests that are marked as ignored if a database is available

## Troubleshooting

### "DATABASE_URL environment variable must be set for tests"

The `DATABASE_URL` environment variable is required and must be explicitly set before running tests:

```bash
export DATABASE_URL=postgres://shuriken:shuriken@localhost:4523/shuriken_test
```

### "Failed to create test database"

Make sure PostgreSQL is running and the `DATABASE_URL` environment variable is set correctly with `shuriken_test` as the database name:

```bash
docker-compose up -d postgres
# Create the test database
docker exec -it $(docker-compose ps -q postgres) psql -U shuriken -c "CREATE DATABASE shuriken_test;"
export DATABASE_URL=postgres://shuriken:shuriken@localhost:4523/shuriken_test
```

### Database Name Safety

If you see log messages like:
```
TestDb: Database name is not 'shuriken_test', changing to 'shuriken_test' for safety
```

These are safety measures that automatically modify the connection URL to prevent running tests against production databases. The modifications are:
- Database name is changed to `shuriken_test` if different

### "Failed to truncate tables"

Ensure migrations have been run on the test database:

```bash
# Make sure DATABASE_URL points to shuriken_test
export DATABASE_URL=postgres://shuriken:shuriken@localhost:4523/shuriken_test
diesel migration run
```

### "Test fails with connection errors"

Check that the database connection pool size is sufficient and that there are no stale connections:

```bash
# Restart the database
docker-compose restart postgres
```

## Additional Resources

- [Diesel documentation](https://diesel.rs/)
- [diesel-async documentation](https://docs.rs/diesel-async/)
- [Salvo test client documentation](https://docs.rs/salvo/latest/salvo/test/)
- [tokio test documentation](https://docs.rs/tokio/latest/tokio/attr.test.html)
