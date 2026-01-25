# Logging and Tracing in Shuriken

## Overview

Shuriken uses the `tracing` ecosystem for structured logging and instrumentation. This provides powerful logging capabilities from error reporting to detailed trace-level debugging.

## Configuration

### Environment Variables

The logging level can be controlled via the `RUST_LOG` environment variable:

```bash
# Info level (default)
RUST_LOG=info cargo run

# Debug level for all modules
RUST_LOG=debug cargo run

# Trace level for specific modules
RUST_LOG=shuriken::component::db=trace cargo run

# Multiple modules with different levels
RUST_LOG=shuriken::component::db=debug,shuriken::app::api=info cargo run

# Verbose everything
RUST_LOG=trace cargo run
```

### Log Levels

The following log levels are used throughout the codebase:

- **ERROR**: Critical errors that require immediate attention
- **WARN**: Warning conditions that may need investigation
- **INFO**: Informational messages about significant events
- **DEBUG**: Detailed information useful for debugging
- **TRACE**: Very detailed information about execution flow

## Instrumentation

### Handler Functions

API handlers are instrumented with `#[tracing::instrument]` to track:
- Request method and path
- Operation timing
- Success/failure status

Example:
```rust
#[handler]
#[tracing::instrument(skip(req, res), fields(path = %req.uri().path()))]
pub async fn put(req: &mut Request, res: &mut Response) {
    tracing::info!("Handling PUT request");
    // ... handler logic
}
```

### Service Functions

Service layer functions use instrumentation to track:
- Database operations
- Business logic execution
- Data validation

Example:
```rust
#[tracing::instrument(skip(conn, ical_bytes), fields(
    collection_id = %ctx.collection_id,
    uri = %ctx.uri
))]
pub async fn put_calendar_object(
    conn: &mut DbConnection<'_>,
    ctx: &PutObjectContext,
    ical_bytes: &[u8],
) -> Result<PutObjectResult> {
    tracing::debug!("Processing PUT calendar object");
    // ... service logic
}
```

### Database Queries

Database query functions are instrumented to track:
- Query execution
- Connection acquisition
- Query results

## Dependencies

The following crates are used for logging:

- **tracing**: Core tracing library
- **tracing-subscriber**: Subscriber implementation with env-filter support
- **tracing-log**: Bridge for compatibility with the `log` crate
- **tracing-futures**: Instrument futures and async code
- **tracing-unwrap**: Better error messages for unwrap/expect
- **reqwest-tracing**: Instrument HTTP requests (when HTTP client is used)
- **test-log**: Enable tracing in tests (dev dependency)

## Testing with Logs

To see logs during tests, use the `test-log` crate with the `#[test_log::test]` attribute:

```rust
#[test_log::test]
fn test_something() {
    tracing::debug!("This will be visible in test output");
    // ... test logic
}
```

Or run tests with `RUST_LOG` set:

```bash
RUST_LOG=debug cargo test
```

## Best Practices

### Log Levels by Context

- Use **ERROR** for unrecoverable errors that affect functionality
- Use **WARN** for recoverable issues or suspicious conditions
- Use **INFO** for request/response logging and significant state changes
- Use **DEBUG** for detailed operation tracking and intermediate states
- Use **TRACE** for very verbose logging like database queries and parser details

### Structured Fields

When using instrumentation, include relevant structured fields:

```rust
#[tracing::instrument(skip(conn), fields(
    user_id = %user_id,
    collection_id = %collection_id
))]
```

This makes logs searchable and filterable.

### Avoid Logging Sensitive Data

Never log:
- Passwords or authentication tokens
- Full credit card numbers
- Personal identifiable information (unless required and documented)
- Request/response bodies that may contain sensitive data

Instead, log:
- Request/response sizes
- Status codes
- Operation outcomes
- Sanitized or hashed identifiers where appropriate

## Examples

### Basic Usage

```rust
// Simple info log
tracing::info!("Server started on port 8698");

// With structured fields
tracing::info!(port = 8698, "Server started");

// Debug with context
tracing::debug!("Processing {} items", items.len());

// Error with context
tracing::error!("Failed to connect to database: {}", err);
```

### Span Context

```rust
let span = tracing::info_span!("process_request", request_id = %id);
let _enter = span.enter();

tracing::debug!("Starting processing");
// ... work happens here
tracing::info!("Processing complete");
```

### Function Instrumentation

```rust
#[tracing::instrument(skip(data))]
async fn process_data(id: uuid::Uuid, data: &[u8]) -> Result<()> {
    tracing::debug!("Data length: {}", data.len());
    // Function entry/exit and duration are automatically logged
    Ok(())
}
```

## Performance Considerations

- Tracing has minimal overhead when filtering is properly configured
- Use appropriate log levels to avoid excessive logging in production
- Consider disabling trace-level logs in production unless debugging
- Structured fields are more efficient than string formatting for high-volume logs

## Future Enhancements

Potential additions to the logging system:

- JSON output format for log aggregation systems
- OpenTelemetry integration for distributed tracing
- Log sampling for high-traffic endpoints
- Per-request log correlation IDs
- Metrics collection alongside logging
