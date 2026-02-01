ALTER TABLE card_index
    DROP COLUMN IF EXISTS fn_unicode_fold,
    DROP COLUMN IF EXISTS fn_ascii_fold,
    DROP COLUMN IF EXISTS data_unicode_fold,
    DROP COLUMN IF EXISTS data_ascii_fold;

ALTER TABLE cal_index
    DROP COLUMN IF EXISTS metadata_unicode_fold,
    DROP COLUMN IF EXISTS metadata_ascii_fold;

ALTER TABLE dav_property
    DROP COLUMN IF EXISTS value_text_unicode_fold,
    DROP COLUMN IF EXISTS value_text_ascii_fold;

-- ALTER TABLE card_index
--     ALTER COLUMN "fn" TYPE text COLLATE "default",
--     ALTER COLUMN uid TYPE text COLLATE "default";

-- ALTER TABLE cal_index
--     ALTER COLUMN rrule_text TYPE text COLLATE "default",
--     ALTER COLUMN uid TYPE text COLLATE "default";

-- ALTER TABLE dav_property
--     ALTER COLUMN value_text TYPE text COLLATE "default";

DROP FUNCTION IF EXISTS unicode_casemap_nfc(text);
DROP FUNCTION IF EXISTS ascii_casemap(text);
DROP FUNCTION IF EXISTS jsonb_unicode_casemap_nfc(jsonb);
DROP FUNCTION IF EXISTS jsonb_ascii_casemap(jsonb);
