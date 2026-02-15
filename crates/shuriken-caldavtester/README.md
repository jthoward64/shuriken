# shuriken-caldavtester

CalDAV/CardDAV test suite runner for the Shuriken server, based on Apple's ccs-caldavtester.

## Overview

This crate provides a Rust-based test execution framework for running the extensive CalDAV and CardDAV test suite originally developed by Apple. It parses XML test definitions, executes HTTP requests against a Shuriken server instance, and verifies responses according to RFC specifications.

## Architecture

The crate is organized into focused, testable modules:

- **`xml`**: Parse test definitions from XML files
- **`runner`**: Orchestrate test execution and result aggregation
- **`context`**: Manage variables and test state with substitution
- **`verification`**: Verify HTTP responses against expected results
- **`server`**: Manage test server lifecycle

### Design Principles

Unlike `shuriken-test`, this crate emphasizes:

1. **Pure Functions**: Parsing and verification logic is side-effect-free
2. **Clear Separation**: HTTP, parsing, and verification are isolated
3. **Testability**: Each module has comprehensive unit tests
4. **Error Handling**: Uses `thiserror` for structured errors
5. **No Global State**: Context is explicitly passed through the call chain

## Usage

### Running Tests Programmatically

```rust
use shuriken_caldavtester::runner::TestRunner;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut runner = TestRunner::new()?;
    
    // Run a single test file
    let results = runner
        .run_test_file("test-suite/tests/CalDAV/get.xml")
        .await?;
    
    println!("Passed: {}, Failed: {}, Ignored: {}",
             results.passed, results.failed, results.ignored);
    
    Ok(())
}
```

### Running via Example

```bash
cargo run -p shuriken-caldavtester --example run_tests
```

### Running Selected Files

```bash
cargo run -p shuriken-caldavtester --example run_selected -- \
    CalDAV/freebusy.xml CalDAV/acl.xml

# Same run, but fail on any unknown callback
cargo run -p shuriken-caldavtester --example run_selected -- \
    --strict-callbacks CalDAV/freebusy.xml CalDAV/acl.xml
```

### Variable Substitution

The test context supports CalDAV-style variable substitution:

```rust
use shuriken_caldavtester::context::TestContext;

let mut ctx = TestContext::new();
ctx.set("$userid:", "testuser");

// Variables are substituted with the pattern $name:
let uri = ctx.substitute("/dav/calendars/$userid:/calendar")?;
// Result: "/dav/calendars/testuser/calendar"
```

## Test Suite Structure

The test suite (in `test-suite/`) is organized as follows:

```
test-suite/
├── tests/
│   ├── CalDAV/          # CalDAV protocol tests
│   └── CardDAV/         # CardDAV protocol tests
├── Resource/
│   ├── CalDAV/          # Test data files for CalDAV
│   ├── CardDAV/         # Test data files for CardDAV
│   └── Common/          # Shared resources
├── LICENSE              # Apache 2.0 license
└── README.md            # Attribution and structure
```

### Test XML Format

Tests are defined in XML with this structure:

```xml
<caldavtest>
    <description>Test description</description>
    
    <require-feature>
        <feature>caldav</feature>
    </require-feature>
    
    <test-suite name="Test Suite Name">
        <test name="1">
            <description>Individual test description</description>
            <request>
                <method>PROPFIND</method>
                <ruri>$calendarpath1:/</ruri>
                <header>
                    <name>Depth</name>
                    <value>0</value>
                </header>
                <data>
                    <content-type>text/xml</content-type>
                    <filepath>Resource/CalDAV/propfind.xml</filepath>
                </data>
                <verify>
                    <callback>statusCode</callback>
                    <arg>
                        <name>status</name>
                        <value>207</value>
                    </arg>
                </verify>
            </request>
        </test>
    </test-suite>
</caldavtest>
```

## Verification Callbacks

The following verification callbacks are implemented:

- **`statusCode`**: Verify HTTP status code
- **`header`**: Verify header exists
- **`headerContains`**: Verify header contains value
- **`dataString`** / **`notDataString`**: Verify body contains / does not contain strings
- **`propfindItems`**: Verify PROPFIND multistatus properties and statuses
- **`propfindValues`**: Verify PROPFIND property values by regex
- **`multistatusItems`**: Verify href/status sets in multistatus responses
- **`prepostcondition`**: Verify DAV pre/postcondition error bodies
- **`xmlElementMatch`**: Verify XPath-like XML element existence/value checks
- **`xmlDataMatch`**: Compare response XML with filterable canonical matching
- **`dataMatch`**: Compare raw response body against expected file content
- **`calendarDataMatch`**: Compare iCalendar data with filters/timezone options
- **`addressDataMatch`**: Compare vCard data with filters
- **`jcalDataMatch`**: Compare jCal JSON body to expected file
- **`jsonPointerMatch`**: Verify JSON pointer existence/value/null with wildcard support
- **`freeBusy`**: Verify freebusy periods by FBTYPE
- **`postFreeBusy`**: Verify schedule-response attendee freebusy and VEVENT counts
- **`acl`** / **`aclItems`**: Verify ACL privilege sets

Unknown callbacks are still tolerated as pass (with warning), but core suite callbacks are now implemented.

## Test Isolation

Each test execution:
1. Starts with a fresh variable context
2. Executes start requests to set up test state
3. Runs test suites sequentially
4. Executes end requests for cleanup
5. Captures and stores response headers for subsequent tests

## Development Status

### Implemented
- ✅ XML parsing infrastructure
- ✅ Test execution framework
- ✅ Variable substitution context
- ✅ Full callback coverage for currently used CalDAV/CardDAV suite verifiers
- ✅ Test result aggregation
- ✅ Detailed per-test failure recording/reporting
- ✅ Focused single-file and selected-file runners

### In Progress / Remaining
- ⏳ In-process server lifecycle integration in `server.rs` (runner currently assumes external server)
- ⏳ Optional strict mode for unknown callbacks (currently warns + pass)
- ⏳ Broader integration run stabilization against partially implemented app features

### Historical TODOs (Completed)
- ✅ PROPFIND/multistatus verification
- ✅ Calendar/vCard/jCal/XML data comparison callbacks
- ✅ Request body loading from files
- ✅ Test filtering and selection via examples

## Attribution

The test suite in `test-suite/` is sourced from Apple's [ccs-caldavtester](https://github.com/apple/ccs-caldavtester) project and is provided under the Apache License 2.0.

## License

The Rust code in this crate is part of the Shuriken project. The test suite files maintain their original Apache 2.0 license from Apple Inc.
