# 16. Implementation Phases

## Phase 0: Database Schema and Architecture

Create database migrations to bring the database up to the level needed for full implementation.

Build out the skeleton file structure and traits that will be used going forward.

## Phase 1: Core Parsing & Serialization

**Goal**: Round-trip iCalendar and vCard data without loss.

1. Implement iCalendar lexer and parser (`src/component/rfc/ical/`)
   - Content line parsing with unfolding
   - Parameter parsing with quoting
   - Value type parsing (DATE, DATE-TIME, DURATION, etc.)
   - RRULE parsing
   
2. Implement iCalendar serializer
   - Content line formatting with folding
   - Canonical ordering for deterministic output

3. Implement vCard parser and serializer (`src/component/rfc/vcard/`)
   - Similar structure to iCalendar
   - Handle vCard-specific escaping

4. Implement WebDAV XML parsing (`src/component/rfc/dav/`)
   - PROPFIND/PROPPATCH/REPORT request parsing
   - Multistatus response generation

**Deliverables**: 
- `ICalParser`, `ICalSerializer` types
- `VCardParser`, `VCardSerializer` types  
- `DavXmlParser`, `DavXmlSerializer` types
- Comprehensive test suites with RFC examples

### Phase 1 Testing Notes

These tests should be mostly pure unit tests with fixture inputs (string in → AST out), plus golden tests for serializer output (AST in → bytes out).

1. **Plan 1.1 — iCalendar lexer and parser**
     - Content line parsing + unfolding
         - `ical_unfold_simple`: folded line with a single leading space unfolds correctly.
         - `ical_unfold_multiple`: multiple folds unfold correctly and preserve bytes.
         - `ical_unfold_invalid`: fold without a preceding line rejects cleanly.
         - `ical_unfold_crlf_only`: accepts CRLF line endings (reject bare LF if you decide to be strict).
     - Parameter parsing with quoting
         - `ical_param_quoted_semicolon`: `CN="Doe\; Jane"` parses to `Doe; Jane`.
         - `ical_param_quoted_comma`: quoted values do not split as multi-valued.
         - `ical_param_multivalue_unquoted`: `ROLE=REQ-PARTICIPANT,OPT-PARTICIPANT` yields two values.
         - `ical_param_bad_quote`: missing closing quote yields parse error with location.
     - Value type parsing
         - `ical_date_basic`: `VALUE=DATE:20260123` parses as date.
         - `ical_datetime_utc`: `20260123T120000Z` parses as UTC.
         - `ical_datetime_tzid`: `TZID=Europe/Berlin:20260123T120000` retains TZID association.
         - `ical_duration`: `PT15M` parses as duration.
         - `ical_text_escaping`: `SUMMARY:hello\, world\nline2` unescapes correctly.
     - RRULE parsing
         - `ical_rrule_basic`: `FREQ=DAILY;COUNT=10`.
         - `ical_rrule_until_vs_count`: reject RRULE that violates your chosen constraints (or accept if you support).
         - `ical_rrule_bysetpos`: parse BYSETPOS with negative values.
         - `ical_rrule_invalid_freq`: invalid FREQ rejects.
     - Structural parsing
         - `ical_component_tree`: VCALENDAR→VEVENT nesting parses correctly.
         - `ical_multi_vevent`: multiple VEVENTs parse and preserve each UID.
         - `ical_unknown_x_props_roundtrip`: unknown `X-` props are preserved.

2. **Plan 1.2 — iCalendar serializer**
     - Content line formatting + folding
         - `ical_fold_boundary_75_octets`: folds at the correct boundary (octets, not chars).
         - `ical_fold_utf8`: does not split multi-byte UTF-8 sequences.
         - `ical_fold_long_param`: long parameter values fold correctly.
     - Canonical ordering / deterministic output
         - `ical_canonical_prop_order`: properties output in your canonical order.
         - `ical_canonical_param_order`: params output in canonical order.
         - `ical_canonical_normalize_lf`: normalizes line endings to CRLF.
     - Round-trip invariants
         - `ical_roundtrip_equivalence`: parse→serialize→parse yields semantically equivalent structure.
         - `ical_normalize_etag_stability`: semantically equivalent inputs produce identical serialized bytes (if you do canonicalization).

3. **Plan 1.3 — vCard parser and serializer**
     - vCard 3.0 + 4.0 input compatibility
         - `vcard_v3_basic`: `BEGIN:VCARD` / `VERSION:3.0` parses.
         - `vcard_v4_basic`: `VERSION:4.0` parses.
         - `vcard_grouped_props`: `item1.EMAIL:...` group name preserved.
     - vCard escaping + folding
         - `vcard_text_escapes_v3`: `\,` and `\n` unescape as expected.
         - `vcard_fold_unfold`: folding/unfolding works like iCalendar.
     - Parameter parsing
         - `vcard_param_type_multi`: `TYPE=HOME,INTERNET` yields two types.
         - `vcard_param_bad_quote`: malformed param quoting rejects.
     - Interop conversion
         - `vcard_emit_v3_for_carddav`: if you choose to emit v3 for compatibility, ensure emitted `VERSION` is v3 and all required mappings are applied.
     - Robustness
         - `vcard_unknown_props_roundtrip`: unknown props preserved.
         - `vcard_invalid_structure`: missing END:VCARD rejects.

4. **Plan 1.4 — WebDAV XML parsing and multistatus generation**
     - Request XML parsing
         - `dav_parse_propfind_allprop`: parse `DAV:propfind` with `allprop`.
         - `dav_parse_propfind_prop`: parse `prop` listing with multiple namespaces.
         - `dav_parse_proppatch_set_remove`: parse set/remove blocks and preserve ordering.
         - `dav_parse_report_unknown`: unknown report name is detected and mapped to correct error path.
         - `dav_parse_report_namespaces`: unknown prefixes / namespace mappings handled correctly.
     - Multistatus serialization (golden tests)
         - `dav_207_propstat_200_404`: same response contains 200 for supported props and 404 for unknown props.
         - `dav_href_encoding`: hrefs are correctly escaped/normalized.
         - `dav_status_line_format`: `HTTP/1.1 200 OK` formatting exactly as expected by strict clients.
     - Robustness
         - `dav_unknown_prop_does_not_fail`: unknown properties do not cause request failure; they just get 404 propstat.

## Phase 2: Database Operations

**Goal**: Store and retrieve DAV resources correctly.

1. Implement entity storage layer (`src/component/db/query/dav/`)
   - `create_entity`, `update_entity`, `get_entity`
   - Component tree CRUD
   - Property/parameter CRUD

2. Implement collection operations
   - `create_collection`, `get_collection`, `list_collections`
   - `update_synctoken`

3. Implement instance operations
   - `create_instance`, `update_instance`, `delete_instance`
   - ETag generation
   - Tombstone creation

4. Implement derived index updates
   - Trigger updates on entity changes
   - `cal_index` population from parsed iCalendar
   - `card_index` population from parsed vCard

**Deliverables**:
- Database query modules
- Mapping functions between parsed types and DB models
- Transaction handling for atomic operations

### Phase 2 Testing Notes

These should be Postgres integration tests. Prefer running migrations into an isolated schema/database and truncating between tests.

1. **Plan 2.1 — Entity storage layer (`create_entity`, `update_entity`, `get_entity`)**
     - Persistence
         - `db_entity_roundtrip_ical`: insert an iCalendar entity and read it back; component tree shape matches.
         - `db_entity_roundtrip_vcard`: insert a vCard entity and read it back.
         - `db_entity_properties_parameters`: properties and parameters are persisted and reloaded exactly.
     - Update semantics
         - `db_entity_update_replaces_tree`: update swaps the component/property tree as intended (replace vs patch).
         - `db_entity_update_idempotent`: applying the same update twice yields identical DB state.
     - Transactionality
         - `db_entity_insert_rollback_on_error`: induce a constraint violation mid-write and assert no partial rows exist.
         - `db_entity_update_rollback_on_error`: same for update paths.

2. **Plan 2.2 — Collection operations (`create_collection`, `get_collection`, `list_collections`, `update_synctoken`)**
     - CRUD + ownership
         - `db_collection_create_get`: created collection returns correct owner principal.
         - `db_collection_list_filters_deleted`: soft-deleted collections are excluded (if applicable).
     - Sync token monotonicity
         - `db_synctoken_increments_on_member_change`: any membership change increments.
         - `db_synctoken_increments_on_content_change`: PUT update increments.
         - `db_synctoken_not_incremented_on_read`: PROPFIND/GET do not increment.

3. **Plan 2.3 — Instance operations (`create_instance`, `update_instance`, `delete_instance`)**
     - Basic CRUD
         - `db_instance_create_then_get`: instance references entity and collection.
         - `db_instance_update_changes_etag`: content update changes etag (if you generate from canonical bytes).
     - Deletion + tombstones
         - `db_instance_delete_creates_tombstone`: tombstone contains href/resource-id and revision.
         - `db_instance_delete_idempotent`: deleting already-deleted resource produces stable outcome.
     - ETag behavior
         - `db_etag_stable_on_read`: multiple reads return same ETag.
         - `db_etag_changes_on_semantic_change`: actual content change changes ETag.

4. **Plan 2.4 — Derived index updates (`cal_index`, `card_index`)**
     - Calendar indexing
         - `db_cal_index_uid_lookup`: UID stored and queryable.
         - `db_cal_index_timerange_query`: DTSTART/DTEND and recurrence-derived bounds support range queries.
     - Card indexing
         - `db_card_index_fn_search`: FN stored and queryable.
         - `db_card_index_email_phone`: emails/phones extracted into index tables.
     - Update propagation
         - `db_index_updates_on_entity_update`: update entity triggers index update.
         - `db_index_cleanup_on_delete`: delete removes/marks index entries consistently.

## Phase 3: Basic HTTP Methods

**Goal**: Support OPTIONS, PROPFIND/PROPPATCH, GET/HEAD, PUT, DELETE, COPY, MOVE.

1. Implement OPTIONS handler
2. Implement PROPFIND handler
    - Property retrieval from DB
    - Depth handling
    - Ensure `DAV:supported-report-set` is returned for collections and reflects the REPORTs you actually implement (and reject unsupported REPORTs with the appropriate error)
    - Multistatus response generation

3. Implement PROPPATCH handler
    - Validate protected properties (reject attempts to set them)
    - Apply writable properties like `DAV:displayname` and DAV/CalDAV/CardDAV descriptions where permitted
    - Return per-property status via `207 Multi-Status`

4. Implement GET/HEAD handler
    - Resource retrieval
    - ETag and Last-Modified headers
    - Content-Type handling

5. Implement PUT handler
    - Parse and validate content
    - Precondition checking
    - If-Match/If-None-Match handling
    - Entity storage

6. Implement DELETE handler
    - Tombstone creation
    - Collection recursive delete

7. Implement COPY/MOVE handlers
    - Enforce destination rules (e.g., CardDAV `addressbook-collection-location-ok`)
    - Preserve/adjust ETags, sync tokens, and tombstones appropriately

8. Implement MKCALENDAR/MKCOL handlers
    - For address books, implement Extended MKCOL request parsing/validation (RFC 5689) so clients can set displayname/description at creation time

**Deliverables**:
- Salvo route handlers in `src/app/api/caldav/` and `src/app/api/carddav/`
- Property resolution logic
- Request validation middleware

### Phase 3 Testing Notes

General approach:
- These are protocol-level integration tests: run the Salvo app against a test Postgres and issue real HTTP requests.
- For each test, assert both:
    - **HTTP correctness**: status code, required headers, and XML/bytes body.
    - **DB correctness**: resource rows, ETag changes, sync-token bumps, and tombstones.

1. **Plan 3.1 — OPTIONS handler**
     - `options_allow_methods_collection`: `Allow` contains expected verbs on a calendar/addressbook collection.
     - `options_allow_methods_item`: `Allow` contains expected verbs on a single `.ics`/`.vcf` resource.
     - `options_dav_header_minimal`: `DAV` header advertises only what’s implemented.
     - `options_no_locking_advertised_without_lock`: do not include class `2` unless LOCK/UNLOCK exists.
     - `options_no_auto_schedule_without_rfc6638`: do not advertise scheduling features unless present.

2. **Plan 3.2 — PROPFIND handler**
     - Depth handling
         - `propfind_depth0_collection`: returns only the collection.
         - `propfind_depth1_collection`: returns collection + immediate members.
         - `propfind_depth_infinity_rejected_or_supported`: whatever you choose, it is consistent and documented.
     - Property resolution
         - `propfind_known_props_200`: common DAV/CalDAV/CardDAV properties return 200 propstat.
         - `propfind_unknown_props_404`: unknown properties return 404 propstat.
         - `propfind_mixed_props_207`: mixed statuses in one multistatus are correct.
     - `DAV:supported-report-set`
         - `propfind_supported_report_set_calendar`: calendar collection advertises calendar reports you implement.
         - `propfind_supported_report_set_addressbook`: addressbook collection advertises carddav reports you implement.
         - `propfind_supported_report_set_consistency`: every advertised report is actually accepted by REPORT; no “lies.”
     - Auth interactions
         - `propfind_unauthenticated_401`: protected collections return 401 (if auth is required).
         - `propfind_unauthorized_403`: authenticated but denied returns 403.

3. **Plan 3.3 — PROPPATCH handler**
     - Protected properties
         - `proppatch_set_protected_prop_403`: protected prop returns 403 in propstat and does not mutate DB.
         - `proppatch_remove_protected_prop_403`: same for remove.
     - Writable properties
         - `proppatch_set_displayname_200`: `DAV:displayname` persists and returns 200.
         - `proppatch_set_description_200`: caldav/carddav description persists (where supported).
         - `proppatch_partial_success_207`: some props succeed while others fail; per-prop statuses correct.
     - Authorization
         - `proppatch_denied_no_mutation`: a denied request yields 403 and does not change writable props.

4. **Plan 3.4 — GET/HEAD handler**
     - Content + metadata
         - `get_calendar_object_content_type`: `.ics` returns correct content-type.
         - `get_vcard_content_type`: `.vcf` returns correct content-type.
         - `head_matches_get_headers`: HEAD matches GET headers.
         - `get_etag_present_and_strong`: ETag exists and is strong (if that’s your design).
     - Conditional requests
         - `get_if_none_match_304`: matching ETag yields 304.
         - `get_if_match_412`: If-Match mismatch yields 412 where applicable.

5. **Plan 3.5 — PUT handler**
     - Precondition handling
         - `put_create_if_none_match_star_ok`: create with `If-None-Match: *` when missing succeeds.
         - `put_create_if_none_match_star_fails_when_exists`: returns 412.
         - `put_update_if_match_required`: if you require If-Match for updates, missing header yields 412/428 (pick one strategy and test it).
         - `put_update_if_match_mismatch_412`: mismatch yields 412.
     - Data validation
         - `put_invalid_ical_valid_calendar_data_precondition`: returns proper CalDAV error element.
         - `put_invalid_vcard_valid_address_data_precondition`: returns proper CardDAV error element.
         - `put_uid_conflict_no_uid_conflict_precondition`: returns `no-uid-conflict` with href.
     - Side effects
         - `put_bumps_synctoken`: collection token increments.
         - `put_updates_etag`: ETag changes on content change.
         - `put_updates_indexes`: derived index rows match new content.

6. **Plan 3.6 — DELETE handler**
     - Resource deletion
         - `delete_item_creates_tombstone`: tombstone created and sync token increments.
         - `delete_item_idempotent`: repeated delete yields stable result (404/204 depending on chosen behavior).
     - Collection deletion
         - `delete_collection_recursive_or_rejected`: whichever you choose, test it explicitly.
         - `delete_collection_does_not_leave_orphans`: no orphaned instances/entities remain.

7. **Plan 3.7 — COPY/MOVE handlers**
     - MOVE as rename
         - `move_rename_item_updates_href`: resource appears at destination.
         - `move_rename_updates_sync_token`: both source and dest collection tokens updated if they differ.
     - Destination rules + conflicts
         - `copy_addressbook_collection_location_ok`: CardDAV destination precondition enforced.
         - `move_destination_exists_conflict`: overwrite/409/412 behavior matches your implementation.
     - Tombstones
         - `move_generates_tombstone_on_source_delete`: old href deletion is visible to sync.

8. **Plan 3.8 — MKCALENDAR/MKCOL (Extended MKCOL) handlers**
     - MKCALENDAR
         - `mkcalendar_creates_calendar_collection`: resourcetype includes calendar.
         - `mkcalendar_initial_props_applied`: displayname/description set at creation time.
     - Extended MKCOL
         - `mkcol_extended_creates_addressbook`: resourcetype includes addressbook.
         - `mkcol_extended_rejects_bad_body`: invalid XML yields 400 with useful error.
         - `mkcol_extended_applies_initial_props`: displayname/description applied.

## Phase 4: Query Reports

**Goal**: Support calendar-query, addressbook-query, multiget.

1. Implement `calendar-query` report
   - Filter parsing
   - Component filtering
   - Property filtering
   - Time-range filtering (with recurrence)

2. Implement `calendar-multiget` report

3. Implement `addressbook-query` report
   - Text matching with collations
   - Property filtering

4. Implement `addressbook-multiget` report

5. Implement `DAV:expand-property` report (RFC 3253)
    - Required by CardDAV for common principal/ACL discovery workflows

6. Implement partial retrieval
   - `calendar-data` component/property selection
   - `address-data` property selection

**Deliverables**:
- Report handler implementations
- Filter evaluation engine
- Collation implementations

### Phase 4 Testing Notes

These should be integration tests that seed data then run REPORT requests, asserting 207 bodies are correct.

1. **Plan 4.1 — `calendar-query` report**
     - Filter parsing
         - `cal_query_rejects_invalid_xml`: malformed XML yields 400.
         - `cal_query_rejects_unknown_elements`: unknown elements handled per your strictness rules.
     - Component + property filtering
         - `cal_query_comp_filter_vevent_only`: returns only VEVENTs.
         - `cal_query_prop_filter_uid`: filter by UID returns correct resources.
     - Time-range filtering
         - `cal_query_timerange_simple`: single event in range included.
         - `cal_query_timerange_exclusive_edges`: boundary conditions match spec/your interpretation.
         - `cal_query_timerange_timezone`: TZID-bearing DTSTART behaves correctly.
     - Recurrence interactions
         - `cal_query_recurring_overlaps_range`: recurring event included when any instance overlaps.
         - `cal_query_override_recurrence_id`: overridden instance behavior is correct.
     - Negative / unsupported
         - `cal_query_unsupported_filter_supported_filter_error`: returns `supported-filter` precondition.

2. **Plan 4.2 — `calendar-multiget` report**
     - `cal_multiget_returns_requested_hrefs`: returns exactly the requested set.
     - `cal_multiget_missing_href_404_in_multistatus`: missing resource yields per-href 404.
     - `cal_multiget_mixed_collections_forbidden`: hrefs outside collection are rejected (403/404 per your policy).

3. **Plan 4.3 — `addressbook-query` report**
     - Text matching + collations
         - `card_query_default_collation_unicode_casemap`: case-insensitive behavior matches chosen default.
         - `card_query_unsupported_collation_supported_collation_error`: returns `supported-collation` error.
         - `card_query_text_match_no_wildcards`: ensure `*` is rejected/treated per RFC constraints.
     - Property filtering
         - `card_query_prop_filter_fn`: returns matching contacts by FN.
         - `card_query_prop_filter_email`: returns matching contacts by email.
         - `card_query_prop_filter_uid`: returns matching contacts by UID.
     - Negative / unsupported
         - `card_query_unsupported_filter_supported_filter_error`.

4. **Plan 4.4 — `addressbook-multiget` report**
     - `card_multiget_returns_vcards`: returns `address-data` with correct version/media type.
     - `card_multiget_missing_href_404_in_multistatus`.

5. **Plan 4.5 — `DAV:expand-property` report**
     - `expand_property_principal_url`: expands `principal-URL`.
     - `expand_property_current_user_privilege_set`: expands ACL-related props used by clients.
     - `expand_property_unknown_prop_404_propstat`: unknown expanded prop yields 404 propstat.
     - `expand_property_cycle_bounded`: cycles or excessive depth are rejected or bounded deterministically.

6. **Plan 4.6 — Partial retrieval (`calendar-data`, `address-data`)**
     - `calendar_data_comp_selection`: request VEVENT only vs full VCALENDAR.
     - `calendar_data_prop_selection`: include/exclude specific properties.
     - `address_data_prop_selection`: include/exclude specific vCard properties.
     - `partial_retrieval_invalid_request_400`: invalid selectors rejected.

## Phase 5: Recurrence & Time Zones

**Goal**: Correct recurrence expansion and time zone handling.

1. Implement RRULE expander
   - Frequency iteration
   - BYxxx rule application
   - UNTIL/COUNT limiting
   - EXDATE exclusion
   - RDATE inclusion

2. Implement VTIMEZONE parser
3. Implement UTC conversion utilities
4. Implement `cal_occurrence` population (optional optimization)

5. Implement `expand` and `limit-recurrence-set` handling

**Deliverables**:
- Recurrence expansion library
- Time zone resolution utilities
- Occurrence cache management

### Phase 5 Testing Notes

1. **Plan 5.1 — RRULE expander**
     - Frequency iteration
         - `rrule_daily_simple`: daily for N occurrences.
         - `rrule_weekly_byday`: weekly BYDAY selection.
         - `rrule_monthly_bymonthday`: monthly BYMONTHDAY.
         - `rrule_yearly_bymonth_byday`: yearly patterns.
     - BYxxx rule application
         - `rrule_bysetpos_positive`: BYSETPOS=1 selects first.
         - `rrule_bysetpos_negative`: BYSETPOS=-1 selects last.
         - `rrule_byeaster_or_unsupported`: explicitly reject unsupported extensions.
     - UNTIL/COUNT limiting
         - `rrule_count_wins`: COUNT stops even if UNTIL later.
         - `rrule_until_inclusive_rules`: boundary behavior consistent.
     - EXDATE exclusion / RDATE inclusion
         - `rrule_exdate_removes_instance`.
         - `rrule_rdate_adds_instance`.
     - Limits
         - `rrule_max_instances_enforced`: beyond max triggers the chosen failure mode.

2. **Plan 5.2 — VTIMEZONE parser**
     - `vtimezone_parse_standard_daylight`: parses standard/daylight blocks.
     - `vtimezone_parse_multiple_transitions`: multiple rules.
     - `vtimezone_unknown_tzid`: unknown TZIDs handled per your policy (reject vs allow as opaque).

3. **Plan 5.3 — UTC conversion utilities**
     - `tz_convert_dst_gap`: non-existent local times handled deterministically.
     - `tz_convert_dst_fold`: ambiguous local times handled deterministically.
     - `tz_convert_roundtrip_instant`: instant preserved for representable times.

4. **Plan 5.4 — `cal_occurrence` population (optional)**
     - `occ_cache_matches_expansion`: cache equals on-the-fly results.
     - `occ_cache_invalidation_on_update`: updates invalidate prior occurrences.
     - `occ_cache_invalidation_on_timezone_change`: timezone updates trigger rebuild.

5. **Plan 5.5 — `expand` + `limit-recurrence-set` handling**
     - `report_expand_returns_instances`: expanded output contains instances.
     - `report_limit_recurrence_set_bounds`: bounded output respects requested limits.
     - `report_expand_limit_interaction`: combined behavior is consistent.

## Phase 6: Synchronization

**Goal**: Support sync-collection report and efficient polling.

1. Implement `sync-collection` report
   - Token validation
   - Change detection
   - Tombstone inclusion
   - New token generation

2. Implement CTag property

3. Implement ETag-based conditional operations

**Deliverables**:
- Sync report handler
- Token management utilities

### Phase 6 Testing Notes

1. **Plan 6.1 — `sync-collection` report**
     - Token validation
         - `sync_invalid_token_valid_sync_token_error`: invalid token yields `valid-sync-token` error element.
         - `sync_token_not_leaked_across_users`: token is scoped to collection + auth context.
     - Change detection
         - `sync_initial_returns_all_members`: empty token returns full membership.
         - `sync_incremental_create`: created resource appears as changed with propstat.
         - `sync_incremental_update`: updated resource appears as changed with propstat.
         - `sync_incremental_delete`: deleted resource appears with 404 status-only response.
         - `sync_no_changes_returns_empty_set`: stable token returns empty changes but new token (if you issue new).
     - Depth constraints
         - `sync_depth_not_zero_400`: Depth != 0 yields 400.
     - Truncation / paging
         - `sync_truncation_507_on_request_uri`: server indicates truncation with 507 for request-URI.
         - `sync_truncation_next_token_progresses`: paging token progresses and eventually completes.
         - `sync_truncation_deterministic_ordering`: repeated sync yields stable ordering to avoid duplicates.

2. **Plan 6.2 — CTag property**
     - `ctag_changes_on_member_add`: add member changes CTag.
     - `ctag_changes_on_member_delete`: delete member changes CTag.
     - `ctag_changes_on_content_update`: update changes CTag.
     - `ctag_stable_on_read_only`: PROPFIND/GET does not change CTag.

3. **Plan 6.3 — ETag-based conditional operations**
     - `put_if_match_concurrent_writers`: two writers; second with stale ETag gets 412.
     - `delete_if_match_mismatch_412`: conditional delete rejected.
     - `copy_move_preserves_or_updates_etag`: behavior is consistent and documented.

## Phase 7: Free-Busy & Scheduling

**Goal**: Support free-busy queries and basic scheduling.

1. Implement `free-busy-query` report
   - Event aggregation
   - Period merging
   - VFREEBUSY generation

2. Implement scheduling collections (inbox/outbox)

3. Implement scheduling detection on PUT
   - ATTENDEE change detection
   - PARTSTAT change detection

4. Implement internal scheduling message delivery

5. (Future) Implement iMIP gateway for external scheduling

**Deliverables**:
- Free-busy aggregation logic
- Scheduling workflow handlers

### Phase 7 Testing Notes

1. **Plan 7.1 — `free-busy-query` report**
     - Aggregation + merging
         - `freebusy_merges_overlaps`: overlapping events merge into one busy period.
         - `freebusy_keeps_gaps`: separate events produce separate periods.
         - `freebusy_boundary_inclusive_rules`: edges behave consistently.
     - Status semantics
         - `freebusy_cancelled_ignored`: CANCELLED does not contribute.
         - `freebusy_transparent_ignored`: TRANSPARENT does not contribute.
     - Authorization semantics
         - `freebusy_allowed_read_freebusy`: allowed at `read-freebusy`.
         - `freebusy_denied_below_read_freebusy`: denied below.
         - `freebusy_does_not_leak_summaries`: response contains only busy time, not event details.

2. **Plan 7.2 — Scheduling collections (inbox/outbox)**
     - `schedule_inbox_outbox_discoverable`: PROPFIND returns inbox/outbox URLs.
     - `schedule_inbox_access_control`: only owner/delegates can read.
     - `schedule_outbox_write_control`: only authorized senders can write.

3. **Plan 7.3 — Scheduling detection on PUT**
     - Organizer/attendee flows
         - `schedule_put_organizer_change_generates_request`: organizer updates generate a REQUEST.
         - `schedule_put_cancel_generates_cancel`: cancellation generates CANCEL.
         - `schedule_put_partstat_change_generates_reply`: attendee PARTSTAT change generates REPLY.
     - Idempotency
         - `schedule_put_same_content_no_duplicates`: identical PUT does not enqueue duplicates.
         - `schedule_put_etag_guarded`: If-Match/ETag prevents accidental double-processing.

4. **Plan 7.4 — Internal scheduling message delivery**
     - `schedule_delivers_to_inbox`: recipient inbox receives correct iTIP.
     - `schedule_delivery_content_type`: correct iCalendar scheduling media type.
     - `schedule_delivery_failure_atomicity`: failure does not corrupt event state.

5. **Plan 7.5 — (Future) iMIP gateway**
     - `imip_outbound_formats_mail`: outbound email formatting contract.
     - `imip_inbound_reply_maps_to_itip`: inbound reply updates event appropriately.

## Phase 8: Authorization Integration

**Goal**: Enforce ACL throughout.

1. Integrate Casbin checks into all handlers
2. Implement privilege discovery properties
    - `DAV:current-user-privilege-set`, `DAV:acl`, `DAV:principal-collection-set`, and related ACL properties expected by WebDAV ACL clients
3. Implement shared calendar/addressbook support
4. Implement `read-free-busy` privilege


**Deliverables**:
- Authorization middleware
- ACL property handlers

### Phase 8 Testing Notes

1. **Plan 8.1 — Integrate Casbin checks into all handlers**
     - Permission matrix (table-driven tests)
         - `auth_matrix_collection_methods`: for each role, assert allowed/denied for PROPFIND/REPORT/PROPPATCH/MKCOL/etc.
         - `auth_matrix_item_methods`: for each role, assert allowed/denied for GET/PUT/DELETE.
     - Additivity rule
         - `auth_additive_collection_grant_applies_to_item`: granting at collection gives same-or-higher on item.
         - `auth_no_lower_item_than_collection`: an explicit lower item grant cannot reduce effective permission.
     - Public principal behavior
         - `auth_public_read_ics_only`: public `.ics` access respects policy.
         - `auth_public_denied_on_private`: public denied where not shared.

2. **Plan 8.2 — Privilege discovery properties**
     - Consistency between PROPFIND and enforcement
         - `acl_current_user_privilege_set_matches_auth`: privileges returned match what endpoints actually permit.
         - `acl_acl_property_visibility`: ACL property returned only when allowed.
     - Authentication vs authorization
         - `acl_unauthenticated_401`: unauthenticated yields 401.
         - `acl_unauthorized_403`: authenticated but denied yields 403.

3. **Plan 8.3 — Shared calendar/addressbook support**
     - Share creation ceilings
         - `share_read_share_can_grant_read_only`: read-share ceiling enforced.
         - `share_edit_share_can_grant_edit_or_lower`: edit-share ceiling enforced.
         - `share_admin_can_grant_admin_or_lower`: admin ceiling enforced.
     - Propagation via containment
         - `share_collection_grant_applies_to_members`: members inherit effective access.
         - `share_revocation_removes_member_access`: revocation removes effective access.

4. **Plan 8.4 — `read-free-busy` privilege**
     - `auth_freebusy_allowed_read_freebusy`: freebusy allowed.
     - `auth_freebusy_denied_read`: ensure below read-freebusy denied.
     - `auth_freebusy_no_event_leak`: ensure no event payload leaks.

## Phase 9: Discovery & Polish

**Goal**: Complete client compatibility.

1. Implement well-known URI handling
2. Implement principal properties
3. Add Apple/Google client compatibility fixes
4. Performance optimization
5. Comprehensive integration tests

**Deliverables**:
- Production-ready CalDAV/CardDAV server

### Phase 9 Testing Notes

1. **Plan 9.1 — Well-known URI handling**
     - `wellknown_caldav_redirect`: correct status and `Location` header.
     - `wellknown_carddav_redirect`: correct status and `Location` header.
     - `wellknown_methods_allowed`: OPTIONS/GET behavior is consistent with your routing.

2. **Plan 9.2 — Principal properties**
     - End-to-end discovery flow
         - `discovery_current_user_principal`: returns a usable principal URL.
         - `discovery_home_set_caldav`: returns calendar-home-set.
         - `discovery_home_set_carddav`: returns addressbook-home-set.
         - `discovery_list_collections_depth1`: client can list calendars/addressbooks.
     - Expand-property discovery
         - `discovery_expand_property_flow`: same discovery works via expand-property.

3. **Plan 9.3 — Apple/Google client compatibility fixes**
     - “Quirk suite” regression tests
         - `quirk_replay_ios_propfind`: replay captured iOS/macOS discovery request.
         - `quirk_replay_ios_report`: replay iOS REPORT request.
         - `quirk_replay_google_sync_polling`: replay token polling patterns.
     - Contract
         - Every quirk fix adds at least one replay test that fails before and passes after.

4. **Plan 9.4 — Performance optimization**
     - Budget/regression tests
         - `perf_report_budget_calendar_query`: calendar-query stays under your target budget on sample dataset.
         - `perf_sync_budget`: sync-collection stays under budget.
     - N+1 protection
         - `perf_no_n_plus_one_on_report`: assert bounded query counts for key endpoints.

5. **Plan 9.5 — Comprehensive integration tests**
     - End-to-end scenario suite
         - `e2e_create_calendar_put_event_query_sync`: create calendar, PUT event, REPORT query, sync.
         - `e2e_create_addressbook_put_vcard_query_sync`: same for CardDAV.
         - `e2e_acl_enforcement_matrix_smoke`: a small matrix smoke test across roles.
     - Failure-path suite
         - `e2e_invalid_calendar_data_errors`: invalid iCal yields correct error.
         - `e2e_invalid_address_data_errors`: invalid vCard yields correct error.
         - `e2e_unsupported_report_error`: unsupported REPORT yields correct error.
         - `e2e_unsupported_filter_error`: unsupported filter yields correct precondition.
         - `e2e_unsupported_collation_error`: unsupported collation yields correct precondition.

---
