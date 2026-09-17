-- ---------------------------------------------------------------------------
-- Fix and widen cal_index.rrule_until_utc extraction.
--
-- Two problems with the previous definition:
--
--   1. It stored a value that depended on the database session timezone.
--      `to_timestamp()` reads its argument in the session zone and returns
--      timestamptz, so the trailing `AT TIME ZONE 'UTC'` applied that offset a
--      second time. On a server east of UTC the stored bound landed *earlier*
--      than the real one, and the pre-filter clause `rrule_until_utc > start`
--      then dropped still-live recurring series from time-range queries.
--
--   2. It matched only `UNTIL=<date>T<time>Z` and `UNTIL=<date>`, so a floating
--      `UNTIL=<date>T<time>` left the column NULL. NULL means "never ends" to
--      the pre-filter: correct, but it never narrows. Since build-vevent.ts
--      emits a floating UNTIL to match a floating DTSTART, that covered every
--      recurring event this server creates with an end date.
--
-- Redefines the maintenance function, then recomputes every affected row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION maintain_cal_index_on_instance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_entity_id UUID;
    v_entity_type TEXT;
BEGIN
    v_entity_id := COALESCE(NEW.entity_id, OLD.entity_id);

    SELECT entity_type INTO v_entity_type
    FROM dav_entity WHERE id = v_entity_id;

    IF v_entity_type IS DISTINCT FROM 'icalendar' THEN
        RETURN NEW;
    END IF;

    -- Remove stale index entries for this entity
    DELETE FROM cal_index WHERE entity_id = v_entity_id;

    -- Skip re-indexing if instance is soft-deleted
    IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Rebuild from current non-deleted component tree
    INSERT INTO cal_index (
        entity_id,
        component_id,
        component_type,
        uid,
        dtstart_utc,
        dtend_utc,
        all_day,
        rrule_text,
        rrule_until_utc,
        rrule_freq,
        rrule_interval,
        metadata
    )
    SELECT
        comp.entity_id,
        comp.id,
        comp.name,
        uid_prop.value_text,
        CASE
            WHEN dtstart_prop.value_type = 'DATE_TIME' THEN dtstart_prop.value_tstz
            WHEN dtstart_prop.value_type = 'DATE'
                THEN (dtstart_prop.value_date || 'T00:00:00Z')::timestamptz
            ELSE NULL
        END,
        CASE
            WHEN dtend_prop.value_type = 'DATE_TIME' THEN dtend_prop.value_tstz
            WHEN dtend_prop.value_type = 'DATE'
                THEN (dtend_prop.value_date || 'T00:00:00Z')::timestamptz
            ELSE NULL
        END,
        (dtstart_prop.value_type = 'DATE'),
        rrule_prop.value_text,
        -- rrule_until_utc: extract UNTIL from RRULE text.
        --
        -- `to_timestamp(...)` reads its input in the *session* timezone and
        -- returns timestamptz, so the previous `to_timestamp(...) AT TIME ZONE
        -- 'UTC'` applied the session offset twice and stored a value up to 28
        -- hours out on any server whose Postgres TimeZone was not UTC. Casting
        -- to a naive `timestamp` first discards that offset and recovers the
        -- digits as written; `AT TIME ZONE 'UTC'` then reads them as UTC. The
        -- result is identical whatever the session timezone is.
        CASE
            WHEN rrule_prop.value_text IS NULL THEN NULL
            WHEN rrule_prop.value_text ~ 'UNTIL=\d{8}T\d{6}Z'
                THEN to_timestamp(
                    (regexp_match(rrule_prop.value_text, 'UNTIL=(\d{8}T\d{6})Z'))[1],
                    'YYYYMMDD"T"HH24MISS'
                )::timestamp AT TIME ZONE 'UTC'
            -- Floating UNTIL (RFC 5545 section 3.3.10 form 1: no trailing Z).
            -- This server emits one whenever DTSTART is floating, so leaving it
            -- NULL would stop the pre-filter narrowing its own recurring events.
            -- Reading it as UTC puts it within one UTC offset of the instant it
            -- really names, and zonePaddedRange already widens the queried
            -- window by more than the largest offset whenever the resolution
            -- zone is not UTC, so the clause stays a superset.
            WHEN rrule_prop.value_text ~ 'UNTIL=\d{8}T\d{6}(?!Z)'
                THEN to_timestamp(
                    (regexp_match(rrule_prop.value_text, 'UNTIL=(\d{8}T\d{6})'))[1],
                    'YYYYMMDD"T"HH24MISS'
                )::timestamp AT TIME ZONE 'UTC'
            WHEN rrule_prop.value_text ~ 'UNTIL=\d{8}(?!T)'
                THEN to_timestamp(
                    (regexp_match(rrule_prop.value_text, 'UNTIL=(\d{8})'))[1],
                    'YYYYMMDD'
                )::timestamp AT TIME ZONE 'UTC'
            ELSE NULL
        END,
        -- rrule_freq: extract FREQ=<value>
        CASE WHEN rrule_prop.value_text IS NOT NULL
            THEN (regexp_match(rrule_prop.value_text, 'FREQ=([A-Z]+)'))[1]
            ELSE NULL
        END,
        -- rrule_interval: extract INTERVAL=<n>, default 1 when RRULE present
        CASE WHEN rrule_prop.value_text IS NOT NULL
            THEN COALESCE(
                (regexp_match(rrule_prop.value_text, 'INTERVAL=(\d+)'))[1]::smallint,
                1
            )
            ELSE NULL
        END,
        jsonb_build_object(
            'summary',     summary_prop.value_text,
            'location',    location_prop.value_text,
            'description', description_prop.value_text
        )
    FROM dav_component comp
    LEFT JOIN dav_property uid_prop
        ON uid_prop.component_id = comp.id
        AND uid_prop.name = 'UID'
        AND uid_prop.deleted_at IS NULL
    LEFT JOIN dav_property dtstart_prop
        ON dtstart_prop.component_id = comp.id
        AND dtstart_prop.name = 'DTSTART'
        AND dtstart_prop.deleted_at IS NULL
    LEFT JOIN dav_property dtend_prop
        ON dtend_prop.component_id = comp.id
        AND dtend_prop.name = 'DTEND'
        AND dtend_prop.deleted_at IS NULL
    LEFT JOIN dav_property rrule_prop
        ON rrule_prop.component_id = comp.id
        AND rrule_prop.name = 'RRULE'
        AND rrule_prop.deleted_at IS NULL
    LEFT JOIN dav_property summary_prop
        ON summary_prop.component_id = comp.id
        AND summary_prop.name = 'SUMMARY'
        AND summary_prop.deleted_at IS NULL
    LEFT JOIN dav_property location_prop
        ON location_prop.component_id = comp.id
        AND location_prop.name = 'LOCATION'
        AND location_prop.deleted_at IS NULL
    LEFT JOIN dav_property description_prop
        ON description_prop.component_id = comp.id
        AND description_prop.name = 'DESCRIPTION'
        AND description_prop.deleted_at IS NULL
    WHERE comp.entity_id = v_entity_id
      AND comp.name IN ('VEVENT', 'VTODO', 'VJOURNAL', 'VFREEBUSY')
      AND comp.deleted_at IS NULL;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Recompute every indexed UNTIL. Rows written under the old definition may be
-- wrong (problem 1) or missing (problem 2), so this does not filter on NULL.
UPDATE cal_index
SET rrule_until_utc = CASE
        WHEN rrule_text ~ 'UNTIL=\d{8}T\d{6}Z'
            THEN to_timestamp(
                (regexp_match(rrule_text, 'UNTIL=(\d{8}T\d{6})Z'))[1],
                'YYYYMMDD"T"HH24MISS'
            )::timestamp AT TIME ZONE 'UTC'
        WHEN rrule_text ~ 'UNTIL=\d{8}T\d{6}(?!Z)'
            THEN to_timestamp(
                (regexp_match(rrule_text, 'UNTIL=(\d{8}T\d{6})'))[1],
                'YYYYMMDD"T"HH24MISS'
            )::timestamp AT TIME ZONE 'UTC'
        WHEN rrule_text ~ 'UNTIL=\d{8}(?!T)'
            THEN to_timestamp(
                (regexp_match(rrule_text, 'UNTIL=(\d{8})'))[1],
                'YYYYMMDD'
            )::timestamp AT TIME ZONE 'UTC'
        ELSE NULL
    END
WHERE rrule_text IS NOT NULL
  AND rrule_text ~ 'UNTIL=';
