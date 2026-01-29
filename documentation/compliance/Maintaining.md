# Maintaining RFC Compliance Documentation

## Overview

These instructions guide LLM assistants in maintaining the Shuriken RFC compliance documentation set. The documentation is interconnected and must be kept in sync as implementation progresses and compliance improves.

---

## Document Ecosystem

### Primary Document: Complete Documentation.md
**Purpose**: Deep technical reference for RFC compliance analysis  
**Audience**: Architects, developers, RFC reviewers  
**Update Frequency**: When compliance analysis changes or phases complete  
**Immutable Sections**: 1-7 (archived analysis from initial/second pass)  
**Dynamic Sections**: 8-12 (architecture analysis, roadmap)

**Structure**:
- Sections 1-7: CalDAV, CardDAV, WebDAV, Database, Parsing, Testing, Auth analysis (reference)
- Section 8: Architectural Alignment Analysis (updates as implementation proceeds)
- Section 9: Missing RFC Requirements (reference; only add newly discovered items)
- Section 10: Protocol vs Storage Layer (reference)
- Section 11: Implementation Roadmap (updates as phases complete)
- Section 12: RFC Requirement Matrices (reference; only add new RFCs)

---

### Executive Document: Summary.md
**Purpose**: 10-minute overview for stakeholders and decision makers  
**Audience**: Project managers, leads, stakeholders  
**Update Frequency**: When overall compliance % changes by >5%  
**Stability**: Relatively stable; reflects high-level status

**Structure**:
- Executive Summary (update compliance % and verdict when phases complete)
- Architectural Verdict (stable: "Sound, no redesign needed")
- Compliance by Layer (update % as phases complete)
- Critical Action Items (remove completed P0 items, promote P1 items)
- Implementation Path (update completed phases)
- Why Design Choices Work (stable reference)
- Minimal RFC 3744 Profile (stable reference)

---

### Navigation Document: Readme.md
**Purpose**: Quick reference and topic navigation  
**Audience**: Anyone looking for specific information  
**Update Frequency**: When major sections are added or compliance changes significantly  
**Stability**: Generally stable

**Structure**:
- Reading paths (stable)
- Topic navigation (add new topics as they emerge)
- Quick decision matrix (update % values as phases complete)
- Document selection guide (stable)

---

### Master Index: Implementation Guide.md
**Purpose**: Entry point and master index for all compliance docs  
**Audience**: All roles  
**Update Frequency**: When documents are added/removed or major milestones hit  
**Stability**: Stable; primary index

**Structure**:
- Document list (add/remove as needed)
- Reading paths (stable)
- Architecture verdict (stable)
- Compliance roadmap table (update % and phase status)
- Quick decision matrix (update answers as implementation proceeds)

---

## Update Scenarios and Actions

### Scenario 1: A Phase is Completed

**Example**: Phase 0 (remove LOCK/UNLOCK from DAV header) is done

**Files to Update**:

1. **Complete Documentation.md**
   - Section 11, Roadmap table: Mark "✅ COMPLETE" for Phase 0
   - Update overall compliance % (e.g., 70% → 72%)
   - If new issues discovered during implementation, add to Section 9

2. **Summary.md**
   - Update "Implementation Path" section: Move Phase 0 to completed
   - Update compliance % at top
   - Update "Critical Action Items": Remove completed Phase 0 items, promote Phase 1
   - Update compliance by layer %

3. **Implementation Guide.md**
   - Roadmap table: Update Phase 0 to show completion
   - Update overall % in intro and roadmap
   - Update "Next Actions" timeline if ahead/behind schedule

4. **IMPLEMENTATION_PATTERNS.md**
   - Update section title: "Pattern 1: DAV Header ✅ IMPLEMENTED"
   - Add note when it was merged (date/commit)
   - Update deployment checklist

---

### Scenario 2: A New RFC Requirement is Discovered

**Example**: During Phase 1, discover RFC 4791 requires `CALDAV:calendar-home-set` property

**Files to Update**:

1. **Complete Documentation.md**
   - Section 9 "Missing RFC Requirements": Add new requirement with RFC section
   - Update compliance % if this is a MUST requirement
   - Section 11 "Implementation Roadmap": Add to appropriate phase
   - Section 12 "RFC Requirement Matrices": Add row to relevant RFC table

2. **IMPLEMENTATION_PATTERNS.md**
   - If this can be a new pattern: Add Pattern 9 with code example
   - Add to relevant phase's implementation details

3. **Summary.md**
   - If compliance % changes: Update top-level %
   - Update "What Still Needs Work" if this is critical

---

### Scenario 3: A Code Pattern is Successfully Implemented

**Example**: Developers implement the property generator pattern from IMPLEMENTATION_PATTERNS.md

**Files to Update**:

1. **IMPLEMENTATION_PATTERNS.md**
   - Update section title: "Pattern 1: Live Property Generators ✅ IMPLEMENTED"
   - Add implementation note: "Merged in commit XXX (date), path: src/component/dav/properties/mod.rs"
   - Update integration example with actual code location
   - Mark deployment checklist item as complete

2. **Complete Documentation.md**
   - Section 8 "Architectural Alignment": Note implementation status
   - Section 11 "Roadmap": Mark related items in current phase as complete

3. **Implementation Guide.md**
   - If this moves compliance %, update roadmap table

---

### Scenario 4: Architecture Decision is Validated or Changed

**Example**: Deep review confirms UUID-based storage is RFC-compliant

**Files to Update**:

1. **Complete Documentation.md**
   - Section 8 "Architectural Alignment": Update verdict on that decision
   - Add reference to validation (RFC section, PR number, analysis date)

2. **Summary.md**
   - Update "Why Design Choices Work" if any validation affects other docs

---

### Scenario 5: Compliance Audit Requires RFC Version Update

**Example**: New RFC 6764 requirements emerge that Shuriken must handle

**Files to Update**:

1. **Complete Documentation.md**
   - Add new section (e.g., "Service Discovery Compliance" for RFC 6764)
   - Section 12 "Matrices": Add RFC 6764 requirements table
   - Update overall compliance % if applicable

2. **Implementation Guide.md**
   - Update roadmap if new phase needed
   - Update quick decision matrix if verdict changes

3. **IMPLEMENTATION_PATTERNS.md**
   - Add new pattern if implementation approach differs

---

## Consistency Rules

### Compliance Percentages

**Rule 1**: Update all 3 locations simultaneously
- Complete Documentation.md (section intro + roadmap table)
- Summary.md (executive summary + "Compliance by Layer")
- Implementation Guide.md (intro + roadmap table)

**Rule 2**: Show progression in tables
- Before: 70% → After: 72% (show exact delta)
- Show progression per phase: Phase 0: 70%→72%, Phase 1: 72%→80%, etc.

**Rule 3**: Only count completed items
- Do NOT speculate on future compliance
- ONLY update when phase is actually done or merged

---

### Cross-References

**Rule 1**: Link between documents
- When Complete Documentation Section 11 updates, reference it in Implementation Guide roadmap
- When Summary mentions "See implementation details", link to Complete Documentation section

**Rule 2**: Maintain consistency
- All references to "Phase 0" use same name everywhere
- All compliance % values match across documents
- All phase completion dates match across documents

**Rule 3**: Don't duplicate detail
- Complete Documentation = source of truth for technical details
- Summary = high-level summary of Complete Documentation
- IMPLEMENTATION_PATTERNS = code examples referenced from Complete Documentation
- Implementation Guide = index only, not original content

---

### RFC References

**Rule 1**: Always cite RFC and section
- ❌ "Missing error handling"
- ✅ "Missing error handling per RFC 4791 §5.3.2"

**Rule 2**: Use consistent formatting
- RFC format: "RFC XXXX §Y.Z.W" (e.g., "RFC 4791 §5.3.2")
- Multiple sections: "RFC 4791 §5.3.1, §5.3.2" or separate citations
- Don't mix citation styles

**Rule 3**: Include RFC title
- First mention: "RFC 4791 (CalDAV) §5.3.2"
- Subsequent: "RFC 4791 §5.3.2" (title optional)

---

## Style Guidelines

### Tone and Voice

**Complete Documentation.md**: Technical, precise, reference-oriented
- "RFC 4791 requires supporting DAV:supported-report-set property"
- Use tables for comparison
- Include section numbers and quotes

**Summary.md**: Executive, accessible, action-oriented
- "Architecture is sound; 46 hours of work reaches 85% compliance"
- Use bullets for actions
- Focus on what matters to decision makers

**IMPLEMENTATION_PATTERNS.md**: Practical, code-focused, example-driven
- "Here's how to build the property generator..."
- Include full code examples
- Show integration points in Shuriken codebase

---

### Formatting Standards

**Compliance Tables**:
```markdown
| Item | Status | Notes | RFC Reference |
|------|--------|-------|---|
| Property X | ✅ Implemented | Completed in Phase 0 | RFC 4791 §5.2 |
| Property Y | ⚠️ Partial | Supports basic case only | RFC 4791 §5.3 |
| Property Z | ❌ Missing | Not yet started | RFC 4791 §5.4 |
```

**Section Headers**:
- Level 1 (`#`): Document title only
- Level 2 (`##`): Major sections
- Level 3 (`###`): Subsections
- Level 4 (`####`): Details
- Don't exceed Level 4

**Links**:
- Internal: `[Complete Documentation.md](Complete Documentation.md)` (relative paths)
- GitHub: `[src/component/auth/mod.rs](src/component/auth/mod.rs)`
- External RFCs: `[RFC 4791](https://tools.ietf.org/html/rfc4791)`

---

## When NOT to Update

### Don't Update For:
- ❌ Typos or formatting cleanup (use a dedicated PR for cleanup)
- ❌ Speculative future work (only update when decided/started)
- ❌ Individual commit messages (batch updates when phases complete)
- ❌ Documentation in code (maintain separately; link but don't duplicate)

### Update Only When:
- ✅ Phase is completed and merged
- ✅ Compliance % officially changes (5%+ delta)
- ✅ New RFC requirement discovered through audit
- ✅ Implementation pattern is validated by code
- ✅ Architecture decision has been made and documented
- ✅ Major milestone achieved (beta, release, etc.)

---

## Version Control Strategy

### Commit Messages When Updating Docs:

**Format**:
```
docs(rfc): [Component] Update compliance status - Phase X completion

- Update Complete Documentation compliance % (70% → 72%)
- Mark Phase 0 complete in roadmap
- Update Summary critical action items
- Update Implementation Guide progress table

RFC: RFC 4791 §5.2 (property generators)
Phase: 0/4
Compliance: 70% → 72%
```

**Components**: `auth`, `caldav`, `carddav`, `storage`, `parsing`, `webdav`, `sync`

---

## Reviewing Updates

**Before Merging RFC Compliance Doc Updates, Verify**:

- [ ] All compliance % values match across all 5 documents
- [ ] RFC citations include section numbers
- [ ] All phase statuses are consistent (don't show Phase 0 complete in one doc, pending in another)
- [ ] Cross-references between docs are accurate
- [ ] New requirements are added to appropriate RFC section
- [ ] Code patterns include file paths and integration points
- [ ] Deployment checklist reflects actual status
- [ ] No speculative statements (only what's actually done)
- [ ] Tone matches document purpose (technical vs executive vs practical)
- [ ] Tables are properly formatted and aligned

---

## Example Update: Phase 1 Completion

**Scenario**: Phase 1 (property generators + precondition errors) is merged

**Step 1: Complete Documentation.md**
```
Old (Section 11 Roadmap Table):
| Phase 1 | 8h | 80% | Property generators, precondition error XML |

New:
| Phase 1 | 8h | ✅ Complete | Property generators (RFC 4791 §5.2), precondition errors (RFC 4791 §1.3.2) |
```

**Step 2: Summary.md**
```
Old (Implementation Path):
- Phase 1 (IN PROGRESS): Property generators, precondition error XML - Estimated 1 week

New:
- Phase 1 (✅ COMPLETE): Property generators, precondition error XML - Completed 2026-02-05
  - Added `supported-report-set` property generator
  - Added `supported-calendar-component-set` property generator
  - Implemented CalDAV precondition error XML builders
```

**Step 3: Update Overall Compliance**
```
Old: 72% (Phase 0 complete)

New: 80% (Phase 0 + 1 complete)

Update in:
- Complete Documentation.md (intro)
- Summary.md (executive summary)
- Implementation Guide.md (intro + roadmap)
```

**Step 4: Implementation Guide.md**
```
Old Roadmap Table:
| Phase 1 | 8h | 80% | Property generators, precondition error XML |

New:
| Phase 1 | 8h | ✅ Complete | Property generators, precondition error XML |
```

**Step 5: IMPLEMENTATION_PATTERNS.md**
```
Old section title:
### Pattern 1: Live Property Generators

New section title:
### Pattern 1: Live Property Generators ✅ IMPLEMENTED

Add note:
**Status**: Implemented and merged (PR #XXX, 2026-02-05)  
**Location**: src/component/dav/properties/mod.rs  
**RFC**: RFC 4791 §5.2, RFC 6352 §6.2
```

---

## Quick Reference Checklist

When updating RFC compliance docs:

**Before Starting**:
- [ ] What phase/feature completed or was discovered?
- [ ] What's the compliance % change?
- [ ] Which RFC sections are affected?
- [ ] Which documents need updates?

**During Update**:
- [ ] Update compliance % in all 3 locations simultaneously
- [ ] Add RFC citations with section numbers
- [ ] Update phase status in roadmap
- [ ] Move completed items to completed section
- [ ] Keep tone appropriate for document
- [ ] Maintain cross-references between docs

**After Update**:
- [ ] Verify all compliance % match across documents
- [ ] Check RFC citations are consistent
- [ ] Confirm phase statuses are consistent
- [ ] Validate no speculative statements
- [ ] Preview markdown formatting

---

## Questions to Ask Before Updating

1. **Is this update based on actual implementation, not speculation?**
   - If speculative: Wait for actual completion
   - If actual: Proceed with update

2. **Does this change the overall compliance %?**
   - If yes: Update all 5 documents
   - If no: Update only affected sections

3. **Is this a new RFC requirement or existing?**
   - If new: Add to Section 9 (Complete Documentation) first
   - If existing: Update status of existing requirement

4. **Does this affect the implementation roadmap?**
   - If yes: Update timeline/phases
   - If no: Update only status

5. **Is there a code pattern or example to add?**
   - If yes: Add to IMPLEMENTATION_PATTERNS.md
   - If no: Update status only

---

## Maintaining the Master Index (Implementation Guide.md)

**Update for**:
- New documents added to ecosystem
- Major compliance milestones (every 5% increase)
- Phase completions
- Major RFC audit findings

**Don't update for**:
- Individual pattern implementations (those go in IMPLEMENTATION_PATTERNS.md)
- Minor RFC requirement discoveries (those go in Complete Documentation.md)
- Small compliance % changes (<5%)

---

## Future LLM Instructions

When a future LLM is asked to update these documents:

1. **First**: Understand which document is the authority for each topic
   - Complete Documentation = technical authority
   - Summary = executive summary of above
   - Others = derived/supporting

2. **Second**: Verify consistency across all related documents

3. **Third**: Maintain the established tone and style for each document

4. **Fourth**: Use this guide to determine what needs updating

5. **Fifth**: Never speculate; only update for actual, confirmed changes

---

**Last Updated**: January 29, 2026  
**Version**: 1.0  
**Applicable To**: RFC compliance documentation set (5 documents)  
**Maintained By**: Any LLM assistant maintaining Shuriken project
