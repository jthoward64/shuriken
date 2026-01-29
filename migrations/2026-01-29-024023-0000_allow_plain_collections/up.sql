-- Allow plain WebDAV collections in addition to calendar and addressbook
ALTER TABLE dav_collection DROP CONSTRAINT IF EXISTS dav_collection_collection_type_check;
ALTER TABLE dav_collection ADD CONSTRAINT dav_collection_collection_type_check 
  CHECK (collection_type IN ('collection', 'calendar', 'addressbook'));

COMMENT ON COLUMN dav_collection.collection_type IS 'collection (plain WebDAV), calendar, or addressbook';
