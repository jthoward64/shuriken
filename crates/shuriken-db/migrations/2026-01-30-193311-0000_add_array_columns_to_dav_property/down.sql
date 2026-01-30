-- Revert array columns and specialized type additions

-- Remove new value types from enum
ALTER TABLE dav_property
  DROP CONSTRAINT dav_property_value_type_check,
  ADD CONSTRAINT dav_property_value_type_check
  CHECK (value_type IN (
    'TEXT',
    'INTEGER',
    'FLOAT',
    'BOOLEAN',
    'DATE',
    'DATE_TIME',
    'DURATION',
    'URI',
    'BINARY',
    'JSON'
  ));

-- Restore original value type matching constraint
ALTER TABLE dav_property
  DROP CONSTRAINT chk_dav_property_value_matches_type,
  ADD CONSTRAINT chk_dav_property_value_matches_type
  CHECK (
    (value_text  IS NULL OR value_type = 'TEXT') AND
    (value_int   IS NULL OR value_type = 'INTEGER') AND
    (value_float IS NULL OR value_type = 'FLOAT') AND
    (value_bool  IS NULL OR value_type = 'BOOLEAN') AND
    (value_date  IS NULL OR value_type = 'DATE') AND
    (value_tstz  IS NULL OR value_type = 'DATE_TIME') AND
    (value_bytes IS NULL OR value_type = 'BINARY') AND
    (value_json  IS NULL OR value_type = 'JSON')
  );

-- Restore original single value constraint
ALTER TABLE dav_property
  DROP CONSTRAINT chk_dav_property_single_value,
  ADD CONSTRAINT chk_dav_property_single_value
  CHECK (
    (CASE WHEN value_text  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_int   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_float IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_bool  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_date  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_tstz  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_bytes IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_json  IS NOT NULL THEN 1 ELSE 0 END)
    <= 1
  );

-- Drop new columns
ALTER TABLE dav_property
  DROP COLUMN value_text_array,
  DROP COLUMN value_date_array,
  DROP COLUMN value_tstz_array,
  DROP COLUMN value_time,
  DROP COLUMN value_interval,
  DROP COLUMN value_tstzrange;
