# Test Infrastructure

This document describes the test infrastructure for the Shuriken CalDAV/CardDAV server.

## Overview

The test infrastructure provides utilities for:
- Setting up and tearing down test database state
- Seeding test data (principals, users, collections, entities, instances, components)
- Running integration tests against a test database
- Making HTTP requests to the test Salvo service

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

## Writing New Tests

### Basic Test Structure

```rust
#[tokio::test]
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
#[tokio::test]
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
