-- Add slug fields to support human-readable paths alongside UUIDs
-- Slugs are stable identifiers that don't change even if the resource name changes
-- URI is now generated in code from slug and UUID

-- Remove uri column from principal (will be generated from slug/id in code)
ALTER TABLE principal DROP COLUMN uri;

-- Principal slugs: stable identifiers for users and groups
-- Supports future discovery via /principals/users/{slug}/ or /groups/{slug}/
ALTER TABLE principal
ADD COLUMN slug TEXT NOT NULL DEFAULT '';

-- Ensure slug is unique within each principal_type (users/groups/system principals)
CREATE UNIQUE INDEX unique_principal_slug_per_type
ON principal(principal_type, slug) WHERE deleted_at IS NULL;

-- Remove uri column from dav_collection (will be generated from slug/id in code)
ALTER TABLE dav_collection DROP COLUMN uri;

-- Collection slugs: stable calendar/addressbook identifiers per owner
-- Supports paths like /users/{owner-slug}/calendars/{collection-slug}/
ALTER TABLE dav_collection
ADD COLUMN slug TEXT NOT NULL DEFAULT '';

-- Link collections to parent collections for hierarchical slug resolution
ALTER TABLE dav_collection
ADD COLUMN parent_collection_id UUID REFERENCES dav_collection(id) ON DELETE CASCADE;

-- Ensure slug is unique per owner and collection
CREATE UNIQUE INDEX unique_collection_slug_per_owner
ON dav_collection(owner_principal_id, slug) WHERE deleted_at IS NULL;

-- Remove uri column from dav_instance (will be generated from slug/id in code)
ALTER TABLE dav_instance DROP COLUMN uri;

-- Instance slugs: stable resource identifiers per collection
-- Supports paths like /calendars/{collection-slug}/events/{instance-slug}.ics
ALTER TABLE dav_instance
ADD COLUMN slug TEXT NOT NULL DEFAULT '';

-- Ensure slug is unique per collection
CREATE UNIQUE INDEX unique_instance_slug_per_collection
ON dav_instance(collection_id, slug) WHERE deleted_at IS NULL;

-- Remove uri column from dav_tombstone (will use uri_variants instead)
ALTER TABLE dav_tombstone DROP COLUMN uri;

-- Tombstone uri_variants: array of URI path forms (UUID-based and slug-based)
-- Structure: ['/uuid-path', '/slug-path']
ALTER TABLE dav_tombstone
ADD COLUMN uri_variants TEXT[] NOT NULL;

COMMENT ON COLUMN principal.slug IS 'Stable human-readable slug for the principal (user/group); does not change even if display_name changes';
COMMENT ON COLUMN dav_collection.slug IS 'Stable human-readable slug for the collection; does not change even if display_name changes';
COMMENT ON COLUMN dav_instance.slug IS 'Stable human-readable slug for the instance; does not change even if content changes';
COMMENT ON COLUMN dav_tombstone.uri_variants IS 'Array of URIs the resource was accessible at, including both UUID-based and slug-based forms';
