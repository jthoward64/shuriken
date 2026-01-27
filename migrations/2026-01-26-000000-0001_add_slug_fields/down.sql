-- Rollback slug fields
DROP INDEX IF EXISTS unique_instance_slug_per_collection;
DROP INDEX IF EXISTS unique_collection_slug_per_owner;
DROP INDEX IF EXISTS unique_principal_slug_per_type;

ALTER TABLE dav_tombstone
DROP COLUMN IF EXISTS uri_variants;

ALTER TABLE dav_instance
DROP COLUMN IF EXISTS slug;

ALTER TABLE dav_collection
DROP COLUMN IF EXISTS slug;

ALTER TABLE principal
DROP COLUMN IF EXISTS slug;

-- Restore uri columns (note: these will be NULL on rollback; populate as needed)
ALTER TABLE dav_tombstone
ADD COLUMN uri TEXT;

ALTER TABLE dav_instance
ADD COLUMN uri TEXT;

ALTER TABLE dav_collection
ADD COLUMN uri TEXT;

ALTER TABLE principal
ADD COLUMN uri TEXT;
