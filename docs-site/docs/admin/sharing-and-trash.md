---
sidebar_position: 6
---

# Sharing, trash, and retention

- **ACL sharing** (`src/services/acl/`, RFC 3744) is the primary
  authorization gate for every DAV operation — grants are per
  user/group/collection/instance, managed via the reusable ACL panel
  throughout the UI.
- **Share-link "Feeds"** (`src/services/share-link/`) are a separate,
  token-based, unauthenticated sharing mechanism for publishing whole
  calendars read-only (see the [user guide](../user/feeds) for the
  workflow). No server-wide config beyond the
  [embed feature flags](./feature-flags).
- **Trash / soft delete** (`src/services/trash/`): deleting a
  calendar/address book or an individual event/contact soft-deletes it
  first. `TRASH_RETENTION_DAYS` (default `30`) controls how long
  soft-deleted items are kept before a daily background sweep
  hard-deletes them; set to `0` to disable the trash entirely (deletes
  become immediate and permanent, and the sweep becomes a no-op). Trash
  is per-user with no admin cross-user view — there is no separate
  admin recovery path.
- **Tombstones** (`src/services/tombstone/`) record deletions for RFC
  6578 `sync-collection` incremental-sync reporting. There is currently
  no visible expiry/cleanup job for this table — worth monitoring table
  growth at scale.
