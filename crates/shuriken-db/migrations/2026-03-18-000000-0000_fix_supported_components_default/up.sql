-- Change supported_components default from ARRAY['VEVENT'] to NULL.
-- A NULL value means "all component types allowed" (VEVENT, VTODO, VJOURNAL, VFREEBUSY).
-- The previous default silently blocked VTODO and other component types.
ALTER TABLE dav_collection ALTER COLUMN supported_components SET DEFAULT NULL;

-- Clear the restrictive default on existing calendar collections that still
-- have the old single-element default, so they accept all component types.
UPDATE dav_collection
SET supported_components = NULL
WHERE supported_components = ARRAY['VEVENT'];
