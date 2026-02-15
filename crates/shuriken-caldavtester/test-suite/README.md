# CalDAV Test Suite

This directory contains the CalDAV/CardDAV test suite from Apple's ccs-caldavtester project.

## Source

These test files are sourced from:
- **Project**: ccs-caldavtester
- **Repository**: https://github.com/apple/ccs-caldavtester
- **License**: Apache License 2.0 (see LICENSE file)
- **Copyright**: (c) 2006-2016 Apple Inc. All rights reserved.

## Structure

- `tests/` - XML test definitions organized by CalDAV and CardDAV
  - `CalDAV/` - CalDAV protocol tests
  - `CardDAV/` - CardDAV protocol tests
- `Resource/` - Test data files (iCalendar, vCard, XML fragments)
  - `CalDAV/` - CalDAV test resources
  - `CardDAV/` - CardDAV test resources
  - `Common/` - Shared resources

## Test Format

Tests are defined in XML files with the following structure:
- `<caldavtest>` - Root element for a test file
- `<test-suite>` - Groups related tests
- `<test>` - Individual test case with request/response verification
- `<request>` - HTTP request specification (method, headers, body)
- `<verify>` - Response verification rules

## Attribution

This test suite is provided under the Apache License 2.0. The original test suite was developed
by Apple Inc. for testing CalDAV and CardDAV server implementations.
