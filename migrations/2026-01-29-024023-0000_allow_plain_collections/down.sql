-- Revert to calendar/addressbook only
ALTER TABLE dav_collection DROP CONSTRAINT IF EXISTS dav_collection_collection_type_check;
ALTER TABLE dav_collection ADD CONSTRAINT dav_collection_collection_type_check 
  CHECK (collection_type IN ('calendar', 'addressbook'));

COMMENT ON COLUMN dav_collection.collection_type IS 'calendar or addressbook';
