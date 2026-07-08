-- ---------------------------------------------------------------------------
-- Add `auto_managed_kind` to dav_collection. Marks collections whose contents
-- are owned and reconciled by a server-side generator (e.g. "birthdays") so
-- DAV handlers can reject client-initiated mutations on them.
--
-- Null on user-created collections — existing rows stay untouched.
-- ---------------------------------------------------------------------------

ALTER TABLE dav_collection ADD COLUMN auto_managed_kind text;
