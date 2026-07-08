-- ---------------------------------------------------------------------------
-- Add `sort_order` to dav_collection: user-controllable ordering within a
-- collection kind. Collections are listed by (sort_order ASC, id ASC); id is
-- uuidv7 so ties fall back to creation order.
--
-- Type-defaults (see src/services/collection/sort-order.ts):
--   normal      = -1000   (user-created collections)
--   subscribed  =     0   (external subscription calendars)
--   generated   =  1000   (server-managed, e.g. birthdays)
--
-- The column default (-1000) backfills every existing row as "normal"; the two
-- UPDATEs below then reclassify subscribed and generated collections.
-- ---------------------------------------------------------------------------

ALTER TABLE dav_collection ADD COLUMN sort_order integer DEFAULT -1000 NOT NULL;
--> statement-breakpoint
UPDATE dav_collection SET sort_order = 1000 WHERE auto_managed_kind IS NOT NULL;
--> statement-breakpoint
UPDATE dav_collection c SET sort_order = 0
FROM external_calendar_claim ecc
WHERE ecc.collection_id = c.id AND c.auto_managed_kind IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dav_collection_order
  ON dav_collection (owner_principal_id, collection_type, sort_order, id)
  WHERE deleted_at IS NULL;
