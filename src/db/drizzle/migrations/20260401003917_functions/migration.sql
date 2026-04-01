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
    SELECT normalize(casefold(input COLLATE "und-x-icu"), NFC);
$$;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jsonb_unicode_casemap_nfc(input jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    /*
     * Unicode casemap for JSONB objects with string fields or string arrays.
     *
     * - Top-level string values are case-mapped.
     * - Array elements that are strings are case-mapped.
     * - Non-string values are preserved unchanged.
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
                        WHEN jsonb_typeof(value) = 'array'
                            THEN (
                                SELECT COALESCE(
                                    jsonb_agg(
                                        CASE
                                            WHEN jsonb_typeof(elem) = 'string'
                                                THEN to_jsonb(unicode_casemap_nfc(elem #>> '{}'))
                                            ELSE elem
                                        END
                                    ),
                                    '[]'::jsonb
                                )
                                FROM jsonb_array_elements(value) AS elem
                            )
                        ELSE value
                    END
                ),
                '{}'::jsonb
            )
            FROM jsonb_each(input)
        )
    END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jsonb_ascii_casemap(input jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    /*
     * ASCII casemap for JSONB objects with string fields or string arrays.
     *
     * - Top-level string values are case-mapped.
     * - Array elements that are strings are case-mapped.
     * - Non-string values are preserved unchanged.
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
                        WHEN jsonb_typeof(value) = 'array'
                            THEN (
                                SELECT COALESCE(
                                    jsonb_agg(
                                        CASE
                                            WHEN jsonb_typeof(elem) = 'string'
                                                THEN to_jsonb(ascii_casemap(elem #>> '{}'))
                                            ELSE elem
                                        END
                                    ),
                                    '[]'::jsonb
                                )
                                FROM jsonb_array_elements(value) AS elem
                            )
                        ELSE value
                    END
                ),
                '{}'::jsonb
            )
            FROM jsonb_each(input)
        )
    END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION update_card_index_search_tsv()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.search_tsv := to_tsvector('english',
        COALESCE(NEW.fn, '') || ' ' ||
        COALESCE(NEW.data->>'n_family', '') || ' ' ||
        COALESCE(NEW.data->>'n_given', '') || ' ' ||
        COALESCE(NEW.data->>'org', '') || ' ' ||
        COALESCE(NEW.data->>'title', '') || ' ' ||
        COALESCE(
            (SELECT string_agg(value::text, ' ')
             FROM jsonb_array_elements_text(NEW.data->'emails')),
            ''
        ) || ' ' ||
        COALESCE(
            (SELECT string_agg(value::text, ' ')
             FROM jsonb_array_elements_text(NEW.data->'phones')),
            ''
        )
    );
    RETURN NEW;
END;
$$;