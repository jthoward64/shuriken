CREATE OR REPLACE FUNCTION unicode_casemap_nfc(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    /*
     * Unicode casemap comparator (RFC 5051-inspired).
     *
     * This implementation:
     *   - Applies Unicode case folding (Postgres casefold())
     *   - Normalizes to NFC (canonical equivalence)
     *
     * NOTE:
     * RFC 5051 specifies compatibility decomposition (≈ NFKD) after
     * titlecasing. We intentionally use NFC here instead:
     *
     *   - Preserves semantic distinctions (e.g., ① ≠ 1)
     *   - Matches modern Unicode and OS behavior
     *   - Avoids over-aggressive compatibility folding
     *
     * This is a conscious, documented divergence from strict RFC 5051.
     */
    SELECT normalize(casefold(input), NFC);
$$;

CREATE OR REPLACE FUNCTION ascii_casemap(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    /*
     * ASCII-only casemap comparator (i;ascii-casemap).
     *
     * Only ASCII A–Z are case-folded.
     * All non-ASCII characters are left unchanged.
     *
     * This matches RFC 4790 semantics exactly.
     */
    SELECT translate(
        input,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'abcdefghijklmnopqrstuvwxyz'
    );
$$;

CREATE OR REPLACE FUNCTION jsonb_unicode_casemap_nfc(input jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    /*
     * Unicode casemap for flat JSONB objects.
     *
     * Only top-level string values are case-mapped.
     * Non-string values are preserved unchanged.
     */
    SELECT CASE
        WHEN input IS NULL THEN NULL
        ELSE (
            SELECT COALESCE(
                jsonb_object_agg(
                    key,
                    CASE
                        WHEN jsonb_typeof(value) = 'string'
                            THEN to_jsonb(unicode_casemap_nfc(value #>> '{}'))
                        ELSE value
                    END
                ),
                '{}'::jsonb
            )
            FROM jsonb_each(input)
        )
    END;
$$;

CREATE OR REPLACE FUNCTION jsonb_ascii_casemap(input jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    /*
     * ASCII-only casemap for flat JSONB objects.
     *
     * Only top-level string values are case-mapped.
     * Non-string values are preserved unchanged.
     */
    SELECT CASE
        WHEN input IS NULL THEN NULL
        ELSE (
            SELECT COALESCE(
                jsonb_object_agg(
                    key,
                    CASE
                        WHEN jsonb_typeof(value) = 'string'
                            THEN to_jsonb(ascii_casemap(value #>> '{}'))
                        ELSE value
                    END
                ),
                '{}'::jsonb
            )
            FROM jsonb_each(input)
        )
    END;
$$;

ALTER TABLE dav_property
    ALTER COLUMN value_text TYPE text COLLATE "C";

ALTER TABLE cal_index
    ALTER COLUMN uid TYPE text COLLATE "C",
    ALTER COLUMN rrule_text TYPE text COLLATE "C";

ALTER TABLE card_index
    ALTER COLUMN uid TYPE text COLLATE "C",
    ALTER COLUMN "fn" TYPE text COLLATE "C";

ALTER TABLE dav_property
    ADD COLUMN value_text_ascii_fold text
        GENERATED ALWAYS AS (ascii_casemap(value_text)) STORED,
    ADD COLUMN value_text_unicode_fold text
        GENERATED ALWAYS AS (unicode_casemap_nfc(value_text)) STORED;

ALTER TABLE cal_index
    ADD COLUMN metadata_ascii_fold jsonb
        GENERATED ALWAYS AS (jsonb_ascii_casemap(metadata)) STORED,
    ADD COLUMN metadata_unicode_fold jsonb
        GENERATED ALWAYS AS (jsonb_unicode_casemap_nfc(metadata)) STORED;

ALTER TABLE card_index
    ADD COLUMN fn_ascii_fold text
        GENERATED ALWAYS AS (ascii_casemap("fn")) STORED,
    ADD COLUMN fn_unicode_fold text
        GENERATED ALWAYS AS (unicode_casemap_nfc("fn")) STORED,
    ADD COLUMN data_ascii_fold jsonb
        GENERATED ALWAYS AS (jsonb_ascii_casemap(data)) STORED,
    ADD COLUMN data_unicode_fold jsonb
        GENERATED ALWAYS AS (jsonb_unicode_casemap_nfc(data)) STORED;
