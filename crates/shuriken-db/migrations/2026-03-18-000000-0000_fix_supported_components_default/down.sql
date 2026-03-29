-- Restore the old default of ARRAY['VEVENT']
ALTER TABLE dav_collection ALTER COLUMN supported_components SET DEFAULT ARRAY['VEVENT'];
