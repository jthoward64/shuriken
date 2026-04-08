ALTER TABLE "cal_index" ADD COLUMN "rrule_until_utc" timestamptz;--> statement-breakpoint
ALTER TABLE "cal_index" ADD COLUMN "rrule_freq" text;--> statement-breakpoint
ALTER TABLE "cal_index" ADD COLUMN "rrule_interval" smallint;--> statement-breakpoint
ALTER TABLE "cal_index" ADD COLUMN "rrule_occurrence_months" smallint[];--> statement-breakpoint
ALTER TABLE "cal_index" ADD COLUMN "rrule_occurrence_day_min" smallint;--> statement-breakpoint
ALTER TABLE "cal_index" ADD COLUMN "rrule_occurrence_day_max" smallint;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Update cal_index maintenance trigger to also extract rrule_until_utc,
-- rrule_freq, and rrule_interval from the RRULE text using regexp_match.
--
-- rrule_occurrence_months / _day_min / _day_max are intentionally left NULL
-- here; they are populated by TypeScript (rrule-temporal) via
-- CalIndexRepository.indexRruleOccurrences() after the save completes.
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
        -- rrule_until_utc: extract UNTIL=<date> from RRULE text
        CASE
            WHEN rrule_prop.value_text IS NULL THEN NULL
            WHEN rrule_prop.value_text ~ 'UNTIL=\d{8}T\d{6}Z'
                THEN to_timestamp(
                    (regexp_match(rrule_prop.value_text, 'UNTIL=(\d{8}T\d{6})Z'))[1],
                    'YYYYMMDD"T"HH24MISS'
                ) AT TIME ZONE 'UTC'
            WHEN rrule_prop.value_text ~ 'UNTIL=\d{8}(?!T)'
                THEN to_timestamp(
                    (regexp_match(rrule_prop.value_text, 'UNTIL=(\d{8})'))[1],
                    'YYYYMMDD'
                ) AT TIME ZONE 'UTC'
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