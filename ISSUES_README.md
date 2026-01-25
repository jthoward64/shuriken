# Creating GitHub Issues for Shuriken Project

This directory contains scripts and documentation for creating GitHub issues to track remaining work across all project phases (0-9).

## Files

- **`GITHUB_ISSUES.md`**: Complete reference documentation for all issues to be created, including detailed descriptions, tasks, and acceptance criteria
- **`create_github_issues.sh`**: Bash script to automatically create all issues using GitHub CLI
- **`ISSUES_README.md`**: This file

## Quick Start

### Option 1: Use the Automated Script (Recommended)

The bash script will create all issues automatically using the GitHub CLI.

**Prerequisites**:
- Install GitHub CLI: https://cli.github.com/
- Authenticate: `gh auth login`

**Run the script**:
```bash
./create_github_issues.sh
```

This will create:
- 10 epic issues (one for each phase)
- ~30 sub-issues for incomplete work
- All issues will be properly labeled and linked

**Note**: The script includes sleep delays between issue creation to avoid rate limiting.

### Option 2: Create Issues Manually

If you prefer manual control or need to customize issues:

1. Review `GITHUB_ISSUES.md` for complete issue details
2. Create each epic issue on GitHub
3. Create sub-issues and link them to their parent epic using "Part of #epic-number"
4. Apply appropriate labels (`epic`, `phase-N`, `P0-P3`, etc.)

## Issue Structure

### Epic Issues
Each phase has an epic issue that provides an overview:
- **Phase 0**: Database Schema ✅ 100% Complete
- **Phase 1**: Parsing & Serialization ✅ 98% Complete
- **Phase 2**: Database Operations ⚠️ 85% Complete
- **Phase 3**: Basic HTTP Methods ⚠️ 90% Complete
- **Phase 4**: Query Reports ✅ 95% Complete
- **Phase 5**: Recurrence & Timezones ✅ 100% Complete
- **Phase 6**: Synchronization ❌ 10% Complete
- **Phase 7**: Free-Busy & Scheduling ❌ 0% Complete
- **Phase 8**: Authorization ⚠️ 40% Complete
- **Phase 9**: Discovery & Polish ❌ 0% Complete

### Sub-Issues
Each epic has sub-issues for incomplete work items. For example:
- Phase 2 has 2 sub-issues (derived indexes, transaction tests)
- Phase 3 has 3 sub-issues (MOVE, MKCALENDAR, MKCOL)
- Phase 6 has 3 sub-issues (sync-collection logic, CTag, indexes)
- etc.

## Labels

Issues use the following label scheme:

### Phase Labels
- `phase-0`, `phase-1`, ..., `phase-9`: Indicates which phase the issue belongs to
- `epic`: Marks epic issues

### Priority Labels
- `P0`: Critical - Blocks production or causes data loss
- `P1`: High - Essential for good UX or RFC compliance
- `P2`: Medium - Important features or performance improvements
- `P3`: Low - Nice-to-have enhancements

### Category Labels
- `rfc-compliance`: RFC compliance issues
- `caldav`, `carddav`: Protocol-specific
- `database`: Database-related
- `performance`: Performance optimization
- `testing`: Test coverage
- `documentation`: Documentation improvements
- `compatibility`: Client compatibility
- And more...

## Linking Issues in PRs

**IMPORTANT**: Always link issues in PR descriptions to maintain traceability.

### Closing Keywords
Use these to automatically close issues when PR is merged:
- `Fixes #123`
- `Closes #456`
- `Resolves #789`

### Reference Keywords
Use these to link without closing:
- `Relates to #123`
- `Part of #456`
- `See #789`
- `Addresses #101`

### Examples

**Good PR Description**:
```markdown
## Summary
Implements MOVE method handler for WebDAV compliance.

## Changes
- Added MOVE handler with Destination header parsing
- Implemented cross-collection moves
- Added tombstone creation for source resource
- Added integration tests

Fixes #42
Part of #35 (Phase 3 epic)
```

**Another Example**:
```markdown
## Summary
Adds derived index population to PUT handlers.

## Changes
- Wire cal_index population into CalDAV PUT
- Wire card_index population into CardDAV PUT
- Add cleanup in DELETE handler
- Add integration tests

Closes #58
Relates to #57 (transaction tests)
Part of #50 (Phase 2 epic)
```

## Project Management

### Milestones
Consider creating milestones for each phase:
- Milestone: Phase 1 - Parsing
- Milestone: Phase 2 - Database
- etc.

Assign issues to milestones to track phase completion.

### Project Board
Use GitHub Projects to visualize progress:
- **Backlog**: Issues not yet started
- **In Progress**: Issues being worked on
- **In Review**: PRs pending review
- **Done**: Completed issues

### Tracking Progress
1. Update issue status regularly
2. Close issues when work is complete and tested
3. Update epic descriptions with sub-issue status
4. Keep phase documentation (in `documenataion/project-status/`) synchronized with issue status

## Estimated Effort

Based on the phase documentation:

- **Phase 1**: 1-2 weeks remaining (minor fixes)
- **Phase 2**: 1 week remaining
- **Phase 3**: 1-2 weeks remaining
- **Phase 4**: 1-2 weeks remaining
- **Phase 6**: 1 week remaining
- **Phase 7**: 4-6 weeks remaining
- **Phase 8**: 2-3 weeks remaining
- **Phase 9**: 4-6 weeks remaining

**Total Estimated Effort**: 15-23 weeks to complete all phases

This assumes full-time work and may vary based on complexity, testing requirements, and parallel work.

## Getting Help

- Review `GITHUB_ISSUES.md` for detailed task descriptions
- Check phase documentation in `documenataion/project-status/Phase N.md`
- Refer to RFC specifications for compliance requirements
- See `documenataion/project-planning/CalDAV-CardDAV-Implementation-Guide.md` for technical details

## After Creating Issues

1. **Review**: Check that all issues were created correctly
2. **Organize**: Set up project board and milestones
3. **Prioritize**: Assign priorities if not already set
4. **Assign**: Distribute issues to team members
5. **Track**: Monitor progress and update status regularly
6. **Link PRs**: Always link PRs to issues

## Notes

- **Phase 0 and Phase 5** are complete and have no sub-issues
- **Phase 7** has the most remaining work (4-6 weeks)
- **Phase 9** is essential for user-friendly setup
- Some issues have dependencies (noted in issue descriptions)

Remember to link issues in all future PRs to maintain traceability! 🎯
