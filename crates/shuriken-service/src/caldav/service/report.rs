//! CalDAV REPORT service layer.

//! Business logic for calendar-query and calendar-multiget reports.

use shuriken_db::db::connection::DbConnection;
use shuriken_db::db::query::caldav::filter::find_matching_instances;
use shuriken_db::db::query::report_property::build_instance_properties;
use shuriken_db::db::schema::cal_index;
use shuriken_db::model::dav::instance::DavInstance;
use shuriken_rfc::rfc::dav::core::{
    CalendarMultiget, CalendarQuery, Href, Multistatus, PropertyName, PropstatResponse,
    RecurrenceExpansion,
};
use chrono::TimeDelta;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use rrule::{RRule, Tz, Unvalidated};

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
            let href = Href::new(format!("/item-{}", instance.slug));
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
    _collection_id: uuid::Uuid,
    multiget: &CalendarMultiget,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    // TODO: parse_and_resolve_path is in app layer - needs refactoring
    // use crate::middleware::path_parser::parse_and_resolve_path;

    let multistatus = Multistatus::new();

    // TODO: This function needs refactoring to accept parsed paths as parameters
    // For now, return empty multistatus to allow compilation
    let _ = (conn, multiget, properties);
    tracing::warn!("execute_calendar_multiget not yet implemented after workspace refactor");
    Ok(multistatus)

    // DISABLED CODE - needs refactoring:
    /*
    // Process each DAV:href in the multiget request
    for href in &multiget.hrefs {
        let href_str = href.as_str();

        // Parse and resolve the full DAV:href path to get the calendar instance
        match parse_and_resolve_path(href_str, conn).await {
            Ok(resolution) => {
                if let Some(inst) = resolution.instance {
                    // Successfully resolved to an instance - build response
                    let props = build_instance_properties(conn, &inst, properties).await?;
                    let response = PropstatResponse::ok(href.clone(), props);
                    multistatus.add_response(response);
                } else {
                    // Path was valid but resolved to no instance (404)
                    let response = PropstatResponse::not_found(href.clone());
                    multistatus.add_response(response);
                }
            }
            Err(PathResolutionError::PrincipalNotFound(_))
            | Err(PathResolutionError::CollectionNotFound { .. })
            | Err(PathResolutionError::InvalidPathFormat(_)) => {
                // Resource not found (404)
                let response = PropstatResponse::not_found(href.clone());
                multistatus.add_response(response);
            }
            Err(e) => {
                // Propagate unexpected errors (DB errors, etc.)
                return Err(anyhow::anyhow!("Path resolution error: {}", e));
            }
        }
    }

    Ok(multistatus)
    */
}

/// ## Summary
/// Executes calendar-query with recurrence expansion.
///
/// For each matching instance, queries its occurrences in the specified time range
/// and generates separate responses based on the expansion mode.
///
/// ## Errors
/// Returns database or parsing errors.
#[expect(clippy::too_many_lines)]
async fn execute_calendar_query_with_expansion(
    conn: &mut DbConnection<'_>,
    instances: Vec<DavInstance>,
    time_range: &shuriken_rfc::rfc::dav::core::TimeRange,
    expansion_mode: RecurrenceExpansion,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    let mut multistatus = Multistatus::new();
    for instance in instances {
        let cal_index_row: Option<(Option<String>, Option<chrono::DateTime<chrono::Utc>>)> =
            match cal_index::table
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
            let rrule: rrule::RRule<Unvalidated> = if let Ok(rule) = rrule_text.parse::<RRule<Unvalidated>>() { rule } else {
                let href = Href::new(format!("/item-{}", instance.slug));
                let props = build_instance_properties(conn, &instance, properties).await?;
                let response = PropstatResponse::ok(href, props);
                multistatus.add_response(response);
                continue;
            };

            let dt_start = dtstart_utc.with_timezone(&Tz::UTC);
            let mut rrule_set: rrule::RRuleSet = if let Ok(set) = rrule.build(dt_start) { set } else {
                let href = Href::new(format!("/item-{}", instance.slug));
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
                        let href = Href::new(format!(
                            "/item-{}?recurrence-id={}",
                            instance.slug, recurrence_id
                        ));
                        let props = build_instance_properties(conn, &instance, properties).await?;
                        let response = PropstatResponse::ok(href, props);
                        multistatus.add_response(response);
                    }
                }
                RecurrenceExpansion::LimitRecurrenceSet => {
                    let href = Href::new(format!("/item-{}", instance.slug));
                    let props = build_instance_properties(conn, &instance, properties).await?;
                    let response = PropstatResponse::ok(href, props);
                    multistatus.add_response(response);
                }
            }
        } else {
            let href = Href::new(format!("/item-{}", instance.slug));
            let props = build_instance_properties(conn, &instance, properties).await?;
            let response = PropstatResponse::ok(href, props);
            multistatus.add_response(response);
        }
    }
    Ok(multistatus)
}
