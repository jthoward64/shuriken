DO $wrapper$
BEGIN
  /*
   * Unicode casemap comparator (RFC 5051-inspired).
   *
   * Applies Unicode case folding + NFC normalization.
   * ICU availability is checked once at migration time so the
   * installed function body has zero branching overhead.
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
  IF EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu') THEN
    -- ICU available: full Unicode case folding via casefold()
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION unicode_casemap_nfc(input text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $body$
        SELECT normalize(casefold(input COLLATE "und-x-icu"), NFC);
      $body$;
    $fn$;
  ELSE
    -- No ICU (e.g. test environments): ASCII lower() as best-effort fallback
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION unicode_casemap_nfc(input text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $body$
        SELECT normalize(lower(input), NFC);
      $body$;
    $fn$;
  END IF;
END
$wrapper$;
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
--> statement-breakpoint
DO $wrapper$
BEGIN
  -- uuidv7() is built-in as of PostgreSQL 18; only create the polyfill on older versions.
  IF (SELECT current_setting('server_version_num')::int) < 180000 THEN
    CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
    DECLARE
      ms bigint;
      ts_hex text;
      rand_a text;
      rand_b text;
      rand_c text;
    BEGIN
      ms      := (extract(epoch from clock_timestamp()) * 1000)::bigint;
      ts_hex  := lpad(to_hex(ms), 12, '0');
      rand_a  := lpad(to_hex((random() * 4095)::bigint), 3, '0');
      rand_b  := lpad(to_hex(((random() * 1023)::bigint | 2048)), 4, '0');
      rand_c  := lpad(to_hex((random() * 281474976710655)::bigint), 12, '0');
      RETURN (
        substring(ts_hex, 1, 8) || '-' ||
        substring(ts_hex, 9, 4) || '-' ||
        '7' || rand_a || '-' ||
        rand_b || '-' ||
        rand_c
      )::uuid;
    END;
    $$ LANGUAGE plpgsql;
  END IF;
END
$wrapper$;
