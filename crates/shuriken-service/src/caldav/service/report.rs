//! CalDAV REPORT service layer.

//! Business logic for calendar-query and calendar-multiget reports.

use chrono::TimeDelta;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use rrule::{RRule, Tz, Unvalidated};
use shuriken_db::db::caldav_keys::{KEY_STATUS, KEY_TRANSP};
use shuriken_db::db::connection::DbConnection;
use shuriken_db::db::query::caldav::filter::find_matching_instances;
use shuriken_db::db::query::report_property::build_instance_properties;
use shuriken_db::db::schema::{cal_index, dav_component, dav_instance, dav_parameter, dav_property};
use shuriken_db::db::{enums::ComponentType, pg_types::PgTstzRange};
use shuriken_db::model::dav::instance::DavInstance;
use shuriken_rfc::rfc::dav::core::{
    CalendarMultiget, CalendarQuery, FreeBusyQuery, Href, Multistatus, PropertyName,
    PropstatResponse, RecurrenceExpansion, TimeRange,
};

use crate::auth::{PathSegment, ResourceLocation};
use crate::error::ServiceResult;

#[derive(Debug, Clone, Copy)]
enum FreeBusyKind {
    Busy,
    Tentative,
    Unavailable,
}

#[derive(Debug, Clone, Copy)]
struct BusyInterval {
    start: chrono::DateTime<chrono::Utc>,
    end: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Default)]
struct FreeBusyBuckets {
    busy: Vec<BusyInterval>,
    tentative: Vec<BusyInterval>,
    unavailable: Vec<BusyInterval>,
}

impl FreeBusyBuckets {
    fn push(&mut self, kind: FreeBusyKind, interval: BusyInterval) {
        if interval.end <= interval.start {
            return;
        }

        match kind {
            FreeBusyKind::Busy => self.busy.push(interval),
            FreeBusyKind::Tentative => self.tentative.push(interval),
            FreeBusyKind::Unavailable => self.unavailable.push(interval),
        }
    }

    fn merge_all(&mut self) {
        self.busy = merge_intervals(std::mem::take(&mut self.busy));
        self.tentative = merge_intervals(std::mem::take(&mut self.tentative));
        self.unavailable = merge_intervals(std::mem::take(&mut self.unavailable));
    }
}

/// ## Summary
/// Builds a proper Href for a calendar item using `ResourceLocation`.
///
/// ## Errors
/// Returns error if `ResourceLocation` serialization fails.
fn build_item_href(
    base_location: &ResourceLocation,
    instance: &DavInstance,
    recurrence_id: Option<&str>,
) -> ServiceResult<Href> {
    let mut segments = base_location.segments().to_vec();
    segments.push(PathSegment::item_from_slug(format!("{}.ics", instance.slug)));

    let location = ResourceLocation::from_segments(segments).map_err(|e| {
        crate::error::ServiceError::ParseError(format!("Failed to build item location: {e}"))
    })?;

    let mut path = location.serialize_to_full_path(true, false)?;

    if let Some(recurrence_id) = recurrence_id {
        path.push_str("?recurrence-id=");
        path.push_str(recurrence_id);
    }

    Ok(Href::new(path))
}

/// ## Summary
/// Executes a calendar-query report.
///
/// Applies filters to find matching calendar objects and builds a multistatus response.
/// If expand or limit-recurrence-set is specified, expands recurring events into
/// individual occurrences.
///
/// ## Side Effects
/// Queries the database for matching instances and their occurrences.
///
/// ## Errors
/// Returns database errors or filter evaluation errors.
pub async fn execute_calendar_query(
    conn: &mut DbConnection<'_>,
    base_location: &ResourceLocation,
    collection_id: uuid::Uuid,
    query: &CalendarQuery,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    // Find instances matching the filter
    let instances = find_matching_instances(conn, collection_id, query).await?;

    // Check if expansion is requested
    if let Some((time_range, expansion_mode)) = &query.expand {
        execute_calendar_query_with_expansion(
            conn,
            base_location,
            instances,
            time_range,
            *expansion_mode,
            properties,
        )
        .await
    } else {
        // No expansion - return instances as-is
        let mut multistatus = Multistatus::new();
        for instance in instances {
            let href = build_item_href(base_location, &instance, None)?;
            let props = build_instance_properties(conn, &instance, properties).await?;
            let response = PropstatResponse::ok(href, props);
            multistatus.add_response(response);
        }
        Ok(multistatus)
    }
}

/// ## Summary
/// Executes a calendar-multiget report.
///
/// RFC 4791 Section 7.9: Retrieves calendar resources by full DAV:href path.
/// Each href is a complete resource path (e.g., `/calendars/alice/work/event-1.ics`)
/// that is resolved to a specific instance and returned with requested properties.
///
/// ## Side Effects
/// Queries the database for each requested resource path resolution and data retrieval.
///
/// ## Errors
/// Returns database errors if queries fail. Missing resources return 404 in response.
pub async fn execute_calendar_multiget(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    multiget: &CalendarMultiget,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    use diesel_async::RunQueryDsl;
    use shuriken_db::db::query::dav::instance;

    let mut multistatus = Multistatus::new();

    // Process each DAV:href in the multiget request
    for href in &multiget.hrefs {
        let href_str = href.as_str();

        // Extract slug from href by taking the last path segment and stripping extensions
        let slug = href_str
            .trim_end_matches(".ics")
            .trim_end_matches(".vcf")
            .split('/')
            .next_back()
            .unwrap_or("")
            .to_string();

        if slug.is_empty() {
            // Invalid href format - return 404
            let response = PropstatResponse::not_found(href.clone());
            multistatus.add_response(response);
            continue;
        }

        // Query for the instance by slug and collection
        let result = instance::by_slug_and_collection(collection_id, &slug)
            .first::<shuriken_db::model::dav::instance::DavInstance>(conn)
            .await;

        match result {
            Ok(inst) => {
                // Successfully resolved to an instance - build response
                let props = build_instance_properties(conn, &inst, properties).await?;
                let response = PropstatResponse::ok(href.clone(), props);
                multistatus.add_response(response);
            }
            Err(diesel::result::Error::NotFound) => {
                // Instance not found (404)
                let response = PropstatResponse::not_found(href.clone());
                multistatus.add_response(response);
            }
            Err(e) => {
                // Propagate unexpected errors (DB errors, etc.)
                return Err(anyhow::anyhow!("Database error: {e}"));
            }
        }
    }

    Ok(multistatus)
}

/// ## Summary
/// Executes a `free-busy-query` report.
///
/// Aggregates busy periods from both `VEVENT` index rows and stored `VFREEBUSY`
/// component periods in the target collection, then serializes a `VFREEBUSY`
/// iCalendar response.
///
/// ## Errors
/// Returns database or recurrence expansion errors.
pub async fn execute_free_busy_query(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    query: &FreeBusyQuery,
) -> anyhow::Result<String> {
    let mut buckets = FreeBusyBuckets::default();

    collect_vevent_periods(conn, collection_id, &query.time_range, &mut buckets).await?;
    collect_vfreebusy_periods(conn, collection_id, &query.time_range, &mut buckets).await?;

    buckets.merge_all();

    Ok(serialize_freebusy_calendar(&query.time_range, &buckets))
}

/// ## Summary
/// Executes calendar-query with recurrence expansion.
///
/// For each matching instance, queries its occurrences in the specified time range
/// and generates separate responses based on the expansion mode.
///
/// ## Errors
/// Returns database or parsing errors.
async fn execute_calendar_query_with_expansion(
    conn: &mut DbConnection<'_>,
    base_location: &ResourceLocation,
    instances: Vec<DavInstance>,
    time_range: &shuriken_rfc::rfc::dav::core::TimeRange,
    expansion_mode: RecurrenceExpansion,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    type CalIndexRow = (Option<String>, Option<chrono::DateTime<chrono::Utc>>);
    let mut multistatus = Multistatus::new();
    for instance in instances {
        let cal_index_row: Option<CalIndexRow> = match cal_index::table
            .filter(cal_index::entity_id.eq(instance.entity_id))
            .filter(cal_index::recurrence_id_utc.is_null())
            .select((cal_index::rrule_text, cal_index::dtstart_utc))
            .first::<(Option<String>, Option<chrono::DateTime<chrono::Utc>>)>(conn)
            .await
        {
            Ok(row) => Some(row),
            Err(diesel::result::Error::NotFound) => None,
            Err(err) => return Err(anyhow::anyhow!(err)),
        };

        if let Some((Some(rrule_text), Some(dtstart_utc))) = cal_index_row {
            let rrule: rrule::RRule<Unvalidated> =
                if let Ok(rule) = rrule_text.parse::<RRule<Unvalidated>>() {
                    rule
                } else {
                    let href = build_item_href(base_location, &instance, None)?;
                    let props = build_instance_properties(conn, &instance, properties).await?;
                    let response = PropstatResponse::ok(href, props);
                    multistatus.add_response(response);
                    continue;
                };

            let dt_start = dtstart_utc.with_timezone(&Tz::UTC);
            let mut rrule_set: rrule::RRuleSet = if let Ok(set) = rrule.build(dt_start) {
                set
            } else {
                let href = build_item_href(base_location, &instance, None)?;
                let props = build_instance_properties(conn, &instance, properties).await?;
                let response = PropstatResponse::ok(href, props);
                multistatus.add_response(response);
                continue;
            };

            if let Some(start) = time_range.start {
                let inclusive_start = start - TimeDelta::seconds(1);
                rrule_set = rrule_set.after(inclusive_start.with_timezone(&Tz::UTC));
            }

            if let Some(end) = time_range.end {
                rrule_set = rrule_set.before(end.with_timezone(&Tz::UTC));
            }

            let occurrences: Vec<chrono::DateTime<rrule::Tz>> = rrule_set.all(u16::MAX).dates;
            if occurrences.is_empty() {
                continue;
            }

            match expansion_mode {
                RecurrenceExpansion::Expand => {
                    for occurrence in occurrences {
                        let recurrence_id = occurrence.with_timezone(&chrono::Utc).to_rfc3339();
                        let href = build_item_href(base_location, &instance, Some(&recurrence_id))?;
                        let props = build_instance_properties(conn, &instance, properties).await?;
                        let response = PropstatResponse::ok(href, props);
                        multistatus.add_response(response);
                    }
                }
                RecurrenceExpansion::LimitRecurrenceSet => {
                    let href = build_item_href(base_location, &instance, None)?;
                    let props = build_instance_properties(conn, &instance, properties).await?;
                    let response = PropstatResponse::ok(href, props);
                    multistatus.add_response(response);
                }
            }
        } else {
            let href = build_item_href(base_location, &instance, None)?;
            let props = build_instance_properties(conn, &instance, properties).await?;
            let response = PropstatResponse::ok(href, props);
            multistatus.add_response(response);
        }
    }
    Ok(multistatus)
}

async fn collect_vevent_periods(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    time_range: &TimeRange,
    buckets: &mut FreeBusyBuckets,
) -> anyhow::Result<()> {
    type EventRow = (
        Option<chrono::DateTime<chrono::Utc>>,
        Option<chrono::DateTime<chrono::Utc>>,
        Option<String>,
        Option<serde_json::Value>,
    );

    let rows: Vec<EventRow> = cal_index::table
        .inner_join(dav_instance::table.on(cal_index::entity_id.eq(dav_instance::entity_id)))
        .filter(dav_instance::collection_id.eq(collection_id))
        .filter(dav_instance::deleted_at.is_null())
        .filter(cal_index::deleted_at.is_null())
        .filter(cal_index::component_type.eq(ComponentType::VEvent.as_str()))
        .filter(cal_index::recurrence_id_utc.is_null())
        .select((
            cal_index::dtstart_utc,
            cal_index::dtend_utc,
            cal_index::rrule_text,
            cal_index::metadata,
        ))
        .load::<EventRow>(conn)
        .await?;

    for (dtstart_utc, dtend_utc, rrule_text, metadata) in rows {
        let Some(kind) = classify_vevent_kind(metadata.as_ref()) else {
            continue;
        };

        let Some(base_start) = dtstart_utc else {
            continue;
        };

        let duration = dtend_utc
            .map(|end| end - base_start)
            .unwrap_or_else(TimeDelta::zero);

        if duration < TimeDelta::zero() {
            continue;
        }

        if let Some(rrule_text) = rrule_text {
            let Ok(rrule) = rrule_text.parse::<RRule<Unvalidated>>() else {
                continue;
            };

            let dt_start = base_start.with_timezone(&Tz::UTC);
            let Ok(mut rrule_set) = rrule.build(dt_start) else {
                continue;
            };

            if let Some(range_start) = time_range.start {
                let inclusive_start = range_start - TimeDelta::seconds(1);
                rrule_set = rrule_set.after(inclusive_start.with_timezone(&Tz::UTC));
            }

            if let Some(range_end) = time_range.end {
                rrule_set = rrule_set.before(range_end.with_timezone(&Tz::UTC));
            }

            for occurrence in rrule_set.all(u16::MAX).dates {
                let occurrence_start = occurrence.with_timezone(&chrono::Utc);
                let occurrence_end = occurrence_start + duration;
                if let Some(clipped) = clip_interval(occurrence_start, occurrence_end, time_range) {
                    buckets.push(kind, clipped);
                }
            }
        } else {
            let base_end = dtend_utc.unwrap_or(base_start);
            if let Some(clipped) = clip_interval(base_start, base_end, time_range) {
                buckets.push(kind, clipped);
            }
        }
    }

    Ok(())
}

async fn collect_vfreebusy_periods(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    time_range: &TimeRange,
    buckets: &mut FreeBusyBuckets,
) -> anyhow::Result<()> {
    let component_ids: Vec<uuid::Uuid> = dav_component::table
        .inner_join(dav_instance::table.on(dav_component::entity_id.eq(dav_instance::entity_id)))
        .filter(dav_instance::collection_id.eq(collection_id))
        .filter(dav_instance::deleted_at.is_null())
        .filter(dav_component::deleted_at.is_null())
        .filter(dav_component::name.eq("VFREEBUSY"))
        .select(dav_component::id)
        .distinct()
        .load::<uuid::Uuid>(conn)
        .await?;

    if component_ids.is_empty() {
        return Ok(());
    }

    let property_rows: Vec<(uuid::Uuid, Option<PgTstzRange>)> = dav_property::table
        .filter(dav_property::component_id.eq_any(&component_ids))
        .filter(dav_property::name.eq("FREEBUSY"))
        .filter(dav_property::deleted_at.is_null())
        .select((dav_property::id, dav_property::value_tstzrange))
        .load::<(uuid::Uuid, Option<PgTstzRange>)>(conn)
        .await?;

    if property_rows.is_empty() {
        return Ok(());
    }

    let property_ids: Vec<uuid::Uuid> = property_rows.iter().map(|(id, _)| *id).collect();

    let param_rows: Vec<(uuid::Uuid, String)> = dav_parameter::table
        .filter(dav_parameter::property_id.eq_any(&property_ids))
        .filter(dav_parameter::deleted_at.is_null())
        .filter(dav_parameter::name.eq("FBTYPE"))
        .select((dav_parameter::property_id, dav_parameter::value))
        .load::<(uuid::Uuid, String)>(conn)
        .await?;

    let fbtype_by_property: std::collections::HashMap<uuid::Uuid, String> =
        param_rows.into_iter().collect();

    for (property_id, range) in property_rows {
        let Some(range) = range else {
            continue;
        };
        let (Some(start), Some(end)) = (range.lower, range.upper) else {
            continue;
        };

        let kind = fbtype_by_property
            .get(&property_id)
            .map_or(FreeBusyKind::Busy, |v| classify_fbtype(v));

        if let Some(clipped) = clip_interval(start, end, time_range) {
            buckets.push(kind, clipped);
        }
    }

    Ok(())
}

fn classify_vevent_kind(metadata: Option<&serde_json::Value>) -> Option<FreeBusyKind> {
    let Some(metadata) = metadata else {
        return Some(FreeBusyKind::Busy);
    };

    let transp = metadata
        .get(KEY_TRANSP)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .map(str::to_ascii_uppercase);

    if transp.as_deref() == Some("TRANSPARENT") {
        return None;
    }

    let status = metadata
        .get(KEY_STATUS)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .map(str::to_ascii_uppercase);

    match status.as_deref() {
        Some("CANCELLED") => None,
        Some("TENTATIVE") => Some(FreeBusyKind::Tentative),
        _ => Some(FreeBusyKind::Busy),
    }
}

fn classify_fbtype(fbtype: &str) -> FreeBusyKind {
    let normalized = fbtype.trim().trim_matches('"').to_ascii_uppercase();
    match normalized.as_str() {
        "BUSY-TENTATIVE" => FreeBusyKind::Tentative,
        "BUSY-UNAVAILABLE" => FreeBusyKind::Unavailable,
        _ => FreeBusyKind::Busy,
    }
}

fn clip_interval(
    start: chrono::DateTime<chrono::Utc>,
    end: chrono::DateTime<chrono::Utc>,
    time_range: &TimeRange,
) -> Option<BusyInterval> {
    if end <= start {
        return None;
    }

    let clipped_start = time_range.start.map_or(start, |range_start| start.max(range_start));
    let clipped_end = time_range.end.map_or(end, |range_end| end.min(range_end));

    if clipped_end <= clipped_start {
        return None;
    }

    Some(BusyInterval {
        start: clipped_start,
        end: clipped_end,
    })
}

fn merge_intervals(mut intervals: Vec<BusyInterval>) -> Vec<BusyInterval> {
    if intervals.len() <= 1 {
        return intervals;
    }

    intervals.sort_by_key(|interval| interval.start);
    let mut merged: Vec<BusyInterval> = Vec::with_capacity(intervals.len());

    for interval in intervals {
        if let Some(last) = merged.last_mut()
            && interval.start <= last.end
        {
            if interval.end > last.end {
                last.end = interval.end;
            }
            continue;
        }
        merged.push(interval);
    }

    merged
}

fn serialize_freebusy_calendar(time_range: &TimeRange, buckets: &FreeBusyBuckets) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Shuriken//CalDAV Server//EN".to_string(),
        "BEGIN:VFREEBUSY".to_string(),
        format!("DTSTAMP:{}", format_ical_utc(chrono::Utc::now())),
    ];

    if let Some(start) = time_range.start {
        lines.push(format!("DTSTART:{}", format_ical_utc(start)));
    }

    if let Some(end) = time_range.end {
        lines.push(format!("DTEND:{}", format_ical_utc(end)));
    }

    append_freebusy_lines(&mut lines, "FREEBUSY", &buckets.busy);
    append_freebusy_lines(
        &mut lines,
        "FREEBUSY;FBTYPE=BUSY-TENTATIVE",
        &buckets.tentative,
    );
    append_freebusy_lines(
        &mut lines,
        "FREEBUSY;FBTYPE=BUSY-UNAVAILABLE",
        &buckets.unavailable,
    );

    lines.push("END:VFREEBUSY".to_string());
    lines.push("END:VCALENDAR".to_string());

    let mut body = lines.join("\r\n");
    body.push_str("\r\n");
    body
}

fn append_freebusy_lines(lines: &mut Vec<String>, prefix: &str, intervals: &[BusyInterval]) {
    for interval in intervals {
        lines.push(format!(
            "{prefix}:{}/{}",
            format_ical_utc(interval.start),
            format_ical_utc(interval.end)
        ));
    }
}

fn format_ical_utc(dt: chrono::DateTime<chrono::Utc>) -> String {
    dt.format("%Y%m%dT%H%M%SZ").to_string()
}
