ALTER TABLE dav_property
    ADD COLUMN group_name TEXT;

COMMENT ON COLUMN dav_property.group_name IS 'vCard property group prefix (e.g., item1 in item1.TEL)';
