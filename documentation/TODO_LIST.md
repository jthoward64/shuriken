# Shuriken TODO List

**Last Updated**: January 30, 2026  
**Purpose**: Comprehensive list of TODOs, incomplete implementations, stubs, and areas needing work across the codebase

---

## 📋 Summary

This document tracks all TODO comments, "for now" implementations, stub code, placeholders, and incomplete areas discovered through codebase analysis. Items are organized by priority and component.

### Statistics

- **Total TODO/FIXME Comments**: 8 items
- **Stub/Placeholder Implementations**: 7 items  
- **"For Now" Temporary Solutions**: 11 items
- **Test Stubs Awaiting Implementation**: 22 items
- **Clippy Expectations (Long Function)**: 2 items

---

## 🔴 Priority 0: Critical / Blocking

### Authentication & Authorization

None currently identified.

---

## 🟠 Priority 1: High Priority

### ✅ 1. Middleware Migration (DEFERRED)

**Location**: [`crates/shuriken-app/src/middleware/mod.rs:5`](../crates/shuriken-app/src/middleware/mod.rs#L5)

```rust
// TODO: Migrate consumers to dav_path_middleware and remove slug_resolver
```

**Impact**: Technical debt - slug_resolver should be deprecated in favor of dav_path_middleware  
**Effort**: Medium (requires migration of all consumers)  
**Status**: Deferred (requires broader refactoring across handlers)

---

### ✅ 2. Location Header in Collection Creation (COMPLETE)

**Locations**:
- [`crates/shuriken-app/src/app/api/caldav/method/mkcalendar.rs:165`](../crates/shuriken-app/src/app/api/caldav/method/mkcalendar.rs#L165)
- [`crates/shuriken-app/src/app/api/carddav/method/mkcol.rs:135`](../crates/shuriken-app/src/app/api/carddav/method/mkcol.rs#L135)

**Impact**: RFC compliance - Location header returned on successful collection creation  
**Effort**: Low (add header to response)  
**Status**: ✅ Complete (2026-01-30) - Commit 80c447b  
**RFC Reference**: RFC 4918 §8.10.4 (Location header for created resources)

---

### ✅ 3. OPTIONS Method Collection Detection (COMPLETE)

**Location**: [`crates/shuriken-app/src/app/api/dav/method/options.rs:19-20`](../crates/shuriken-app/src/app/api/dav/method/options.rs#L19)

**Impact**: RFC compliance - Allow header reflects resource type capabilities  
**Effort**: Medium (requires depot inspection)  
**Status**: ✅ Complete (2026-01-30) - Commit 9c597c1  
**RFC Reference**: RFC 4918 §9.1 (OPTIONS method)

---

## 🟡 Priority 2: Medium Priority

### 4. Authorization - Glob Segment Structural Separation (DEFERRED)

**Location**: [`crates/shuriken-service/src/auth/resource.rs:56`](../crates/shuriken-service/src/auth/resource.rs#L56)

```rust
// TODO: Structurally separate Glob from the normal segments so that it is impossible to accidentally have in non-auth uses
```

**Impact**: Code safety - prevent accidental use of Glob in non-authorization contexts  
**Effort**: Medium (refactor ResourcePath type structure)  
**Status**: Deferred (user will handle separately)

---

### ✅ 5. Recurrence Processing Refactoring (COMPLETE)

**Location**: [`crates/shuriken-service/src/caldav/recurrence.rs:57`](../crates/shuriken-service/src/caldav/recurrence.rs#L57)

**Impact**: Code maintainability - long function split into helpers  
**Effort**: Medium (extract helper functions)  
**Status**: ✅ Complete (2026-01-30) - Commit 1d8cd73

---

### 6. List Type Property Storage

**Location**: [`crates/shuriken-db/src/db/map/dav/extract.rs:78-79`](../crates/shuriken-db/src/db/map/dav/extract.rs#L78)

```rust
// Store list types as text (raw value) for now
// TODO: Consider storing first element or handling lists specially
```

**Impact**: Data model - list properties currently stored as text; may need special handling  
**Effort**: Medium (requires schema and mapping changes)  
**Status**: Deferred (current approach works)

---

## 🟢 Priority 3: Lower Priority / Enhancements

### 7. PROPFIND Stub Response

**Location**: [`crates/shuriken-app/src/app/api/dav/method/propfind/helpers.rs:195-203`](../crates/shuriken-app/src/app/api/dav/method/propfind/helpers.rs#L195)

```rust
// For now, create a stub response
// ...
// Stub: Return a minimal response for the requested resource
```

**Impact**: Feature completeness - PROPFIND returns stub responses in some cases  
**Effort**: Medium (implement full property discovery)  
**Status**: Partial implementation

---

### 8. REPORT Property Stub Implementation

**Location**: [`crates/shuriken-app/src/app/api/dav/method/report.rs:489`](../crates/shuriken-app/src/app/api/dav/method/report.rs#L489)

```rust
// Stub implementation: Return common properties based on path patterns
```

**Impact**: Feature completeness - REPORT returns stub properties  
**Effort**: Medium (implement full property generators)  
**Status**: Partial implementation

---

### 9. Complex Type Property Serialization

**Location**: [`crates/shuriken-app/src/app/api/dav/method/report.rs:681`](../crates/shuriken-app/src/app/api/dav/method/report.rs#L681)

```rust
// For complex types, just use empty element for now
```

**Impact**: Feature completeness - complex properties return empty elements  
**Effort**: Medium (implement full property serialization)  
**Status**: Partial implementation

---

### 10. Nested Expansion in Recurrence

**Location**: [`crates/shuriken-rfc/src/rfc/dav/parse/report.rs:1165`](../crates/shuriken-rfc/src/rfc/dav/parse/report.rs#L1165)

```rust
// For now, we don't support nested expansion
```

**Impact**: Feature completeness - nested recurrence expansion not supported  
**Effort**: High (complex recurrence logic)  
**Status**: Not started

---

### 11. Text Collation RFC 4790 Compliance

**Location**: [`crates/shuriken-db/src/db/query/text_match.rs:94`](../crates/shuriken-db/src/db/query/text_match.rs#L94)

```rust
// Note: Full RFC 4790 compliance would require a pre-folded column in the DB
```

**Impact**: RFC compliance - text matching collation not fully RFC 4790 compliant  
**Effort**: High (requires schema changes and ICU4X integration)  
**Status**: Deferred  
**RFC Reference**: RFC 4790 (Internationalized String Collation)

---

### ✅ 12. ASCII Casemap ß Folding (NOT A BUG)

**Location**: [`crates/shuriken-db/src/db/query/carddav/filter.rs:860`](../crates/shuriken-db/src/db/query/carddav/filter.rs#L860)

```rust
// Note: ASCII casemap uses simple to_lowercase, which doesn't fold ß
```

**Impact**: Edge case - German ß (sharp s) not handled in ASCII casemap  
**Effort**: N/A  
**Status**: ✅ Not a bug - RFC 4790 §9.2.1 specifies that i;ascii-casemap only treats ASCII letters (a-z) case-insensitively. Non-ASCII characters like ß are intentionally not folded. Current implementation is correct per spec.

---

## 📝 Temporary "For Now" Implementations

### CalDAV Service

1. **CalDAV Object Update - ETag Only Update**  
   **Location**: [`crates/shuriken-service/src/caldav/service/object.rs:167`](../crates/shuriken-service/src/caldav/service/object.rs#L167)  
   ```rust
   // For now, just update the ETag and sync revision
   ```
   **Status**: Partial implementation (full tree update not implemented)

2. **CalDAV Object Creation - Minimal Entity**  
   **Location**: [`crates/shuriken-service/src/caldav/service/object.rs:223`](../crates/shuriken-service/src/caldav/service/object.rs#L223)  
   ```rust
   // For now, create a minimal entity without the full tree
   ```
   **Status**: Partial implementation (full component tree not stored)

### CardDAV Service

3. **CardDAV Object Update - ETag Only Update**  
   **Location**: [`crates/shuriken-service/src/carddav/service/object.rs:159`](../crates/shuriken-service/src/carddav/service/object.rs#L159)  
   ```rust
   // For now, just update the ETag and sync revision
   ```
   **Status**: Partial implementation (mirrors CalDAV pattern)

4. **CardDAV Object Creation - Minimal Entity**  
   **Location**: [`crates/shuriken-service/src/carddav/service/object.rs:200`](../crates/shuriken-service/src/carddav/service/object.rs#L200)  
   ```rust
   // For now, create a minimal entity without the full tree
   ```
   **Status**: Partial implementation (mirrors CalDAV pattern)

### Integration Tests

5. **DELETE Handler Test - Stub Verification**  
   **Location**: [`crates/shuriken-app/src/app/api/dav/method/delete_tests.rs:64`](../crates/shuriken-app/src/app/api/dav/method/delete_tests.rs#L64)  
   ```rust
   // For now, verify the handler is callable
   ```
   **Status**: Test needs expansion

6. **REPORT Test - Structure Verification Only**  
   **Location**: [`crates/shuriken-test/tests/integration/report.rs:689`](../crates/shuriken-test/tests/integration/report.rs#L689)  
   ```rust
   // For now, test that response structure is correct
   ```
   **Status**: Test needs expansion

7. **Casbin Test - Expected Behavior Documentation**  
   **Location**: [`crates/shuriken-service/src/auth/casbin_test.rs:1767`](../crates/shuriken-service/src/auth/casbin_test.rs#L1767)  
   ```rust
   // For now, this test documents the expected behavior
   ```
   **Status**: Test documents expected behavior, not a bug

### RFC Parser - Test Leniency

8. **iCalendar Serializer Test - Lenient Comparison**  
   **Location**: [`crates/shuriken-rfc/src/rfc/ical/build/serializer.rs:502`](../crates/shuriken-rfc/src/rfc/ical/build/serializer.rs#L502)  
   ```rust
   // Let's make this test more lenient for now
   ```
   **Status**: Test relaxed for practical parsing

9. **iCalendar Serializer - Parse Verification Only**  
   **Location**: [`crates/shuriken-rfc/src/rfc/ical/build/serializer.rs:518`](../crates/shuriken-rfc/src/rfc/ical/build/serializer.rs#L518)  
   ```rust
   // For now, just verify we can parse it
   ```
   **Status**: Minimal test coverage

---

## 🧪 Test Stubs Awaiting Implementation

All tests in the following files contain placeholder `// TODO: Implement once test DB helper is available`:

### Database Query Tests - Entity Module

**Location**: [`crates/shuriken-db/src/db/query/dav/tests/entity.rs`](../crates/shuriken-db/src/db/query/dav/tests/entity.rs)

All 11 test functions are stubs:
- Line 23: `test_by_id_found`
- Line 37: `test_by_id_not_found`
- Line 51: `test_by_uid`
- Line 66: `test_by_collection_and_uid_found`
- Line 81: `test_by_collection_and_uid_not_found`
- Line 96: `test_by_ids`
- Line 112: `test_create_entity`
- Line 125: `test_update_content_type`
- Line 140: `test_soft_delete`
- Line 154: `test_hard_delete`
- Line 168: `test_restore_soft_deleted`

**Status**: Awaiting test DB helper implementation  
**Blocker**: Need test database scaffolding utilities

### Database Query Tests - Instance Module

**Location**: [`crates/shuriken-db/src/db/query/dav/tests/instance.rs`](../crates/shuriken-db/src/db/query/dav/tests/instance.rs)

All 13 test functions are stubs:
- Line 23: `test_by_id_found`
- Line 39: `test_by_id_not_found`
- Line 56: `test_by_entity_id`
- Line 72: `test_by_collection_id`
- Line 86: `test_by_collection_and_slug_found`
- Line 101: `test_by_collection_and_slug_not_found`
- Line 146: `test_by_ids`
- Line 161: `test_create_instance`
- Line 175: `test_update_etag`
- Line 190: `test_soft_delete`
- Line 205: `test_hard_delete`
- Line 220: `test_restore_soft_deleted`
- Line 234: `test_increment_revision_and_sync_token`

**Status**: Awaiting test DB helper implementation  
**Blocker**: Need test database scaffolding utilities

---

## 🔧 Placeholder Values

### UUID Placeholders in Mapping Functions

These are intentional placeholders that get replaced after insert operations:

1. **vCard Mapping - Placeholder IDs**  
   **Location**: [`crates/shuriken-db/src/db/map/dav/vcard.rs:41`](../crates/shuriken-db/src/db/map/dav/vcard.rs#L41)  
   ```rust
   // Placeholder IDs - will be replaced after insert
   ```
   **Status**: Expected behavior (IDs assigned by DB)

2. **vCard Mapping - Property Placeholder**  
   **Location**: [`crates/shuriken-db/src/db/map/dav/vcard.rs:100`](../crates/shuriken-db/src/db/map/dav/vcard.rs#L100)  
   ```rust
   let property_id = uuid::Uuid::nil(); // Placeholder
   ```
   **Status**: Expected behavior

3. **iCal Mapping - Entity Placeholder**  
   **Location**: [`crates/shuriken-db/src/db/map/dav/ical.rs:44`](../crates/shuriken-db/src/db/map/dav/ical.rs#L44)  
   ```rust
   // Placeholder entity_id - will be replaced after insert
   ```
   **Status**: Expected behavior

4. **iCal Mapping - Component Placeholder**  
   **Location**: [`crates/shuriken-db/src/db/map/dav/ical.rs:80`](../crates/shuriken-db/src/db/map/dav/ical.rs#L80)  
   ```rust
   let component_id = uuid::Uuid::nil(); // Placeholder
   ```
   **Status**: Expected behavior

5. **iCal Mapping - Property Placeholder**  
   **Location**: [`crates/shuriken-db/src/db/map/dav/ical.rs:146`](../crates/shuriken-db/src/db/map/dav/ical.rs#L146)  
   ```rust
   let property_id = uuid::Uuid::nil(); // Placeholder
   ```
   **Status**: Expected behavior

---

## 📊 Code Quality & Technical Debt

### Clippy Expectations

1. **Too Many Lines - Recurrence Processing**  
   **Location**: [`crates/shuriken-service/src/caldav/recurrence.rs:57`](../crates/shuriken-service/src/caldav/recurrence.rs#L57)  
   **Status**: Tracked under Priority 2 item #5

2. **Too Many Lines - RRULE Test Cases**  
   **Location**: [`crates/shuriken-test/tests/rrule_cases_data/mod.rs:14`](../crates/shuriken-test/tests/rrule_cases_data/mod.rs#L14)  
   ```rust
   #[expect(clippy::too_many_lines)]
   ```
   **Status**: Test data file; acceptable

---

## 🚫 Not TODO Items (False Positives)

The following were identified in the search but are **NOT** TODO items:

### Component Names (VTODO)
- All references to "VTODO" are iCalendar component types, not TODO comments
- Files: `cal_index.rs`, `enums.rs`, `schema.rs`, various test files
- Status: ✅ Valid code, not action items

### Test Panic Messages
- `panic!` calls in tests with descriptive messages
- Purpose: Test assertions
- Status: ✅ Valid test code

### Documentation Comments
- "Note:" comments explaining implementation decisions
- Purpose: Code documentation
- Status: ✅ Valid documentation

### Derive Attributes
- `PartialEq`, `PartialOrd` derives
- Purpose: Trait implementations
- Status: ✅ Valid code

---

## 📅 Recommended Action Plan

### Immediate (This Sprint)
1. ✅ **P1 Item #2**: Add Location headers to MKCALENDAR and MKCOL (2 hours)
2. ✅ **P1 Item #3**: Implement OPTIONS collection detection (4 hours)

### Short Term (Next Sprint)
3. **P1 Item #1**: Migrate to dav_path_middleware (8 hours)
4. **P2 Item #4**: Refactor Glob segment separation (6 hours)

### Medium Term (Next Quarter)
5. **P2 Item #5**: Refactor recurrence processing (8 hours)
6. **P3 Items #7-9**: Complete PROPFIND/REPORT stub implementations (16 hours)
7. **Test Stubs**: Implement test DB helper and complete query tests (24 hours)

### Long Term (Future)
8. **P2 Item #6**: Evaluate list property storage strategy (16 hours)
9. **P3 Item #11**: Full RFC 4790 collation compliance (32 hours)
10. **P3 Item #10**: Nested recurrence expansion (40 hours)

---

## 📈 Tracking

### Completion Status

| Priority | Total | Complete | In Progress | Not Started |
|----------|-------|----------|-------------|-------------|
| P0       | 0     | 0        | 0           | 0           |
| P1       | 3     | 2        | 0           | 1           |
| P2       | 3     | 1        | 0           | 2           |
| P3       | 6     | 0        | 0           | 6           |
| Tests    | 24    | 0        | 0           | 24          |
| **Total**| **36**| **3**    | **0**       | **33**      |

### By Component

| Component           | TODO Items | Status |
|---------------------|------------|--------|
| Middleware          | 1          | ⚠️ P1  |
| HTTP Handlers       | 4          | ⚠️ P1-P3 |
| Authorization       | 1          | 🟡 P2  |
| CalDAV Service      | 3          | 🟢 P2-P3 |
| CardDAV Service     | 2          | 🟢 P3  |
| Database Mapping    | 1          | 🟡 P2  |
| RFC Parsing         | 3          | 🟢 P3  |
| Testing             | 24         | 🧪 Blocked |

---

## 🔗 Related Documentation

- [RFC Compliance Summary](compliance/Summary.md) - Overall compliance status
- [Implementation Guide](compliance/Implementation%20Guide.md) - RFC implementation patterns
- [Complete Documentation](compliance/Complete%20Documentation.md) - Detailed RFC analysis

---

**Maintainer Notes**:
- Update this document when new TODOs are added or completed
- Mark items as complete with ✅ and add completion date
- Re-prioritize as project needs evolve
- Run periodic searches for new TODO/FIXME comments

**Last Search**: January 30, 2026 (patterns: TODO, FIXME, stub, placeholder, "for now", unimplemented)
