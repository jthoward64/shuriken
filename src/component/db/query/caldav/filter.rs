//! `CalDAV` filter evaluation for calendar-query reports.
//!
//! Implements filter logic for component-filter, time-range-filter,
//! and property-filter matching against calendar data.

use crate::component::db::connection::DbConnection;
use crate::component::db::schema::{cal_index, dav_instance};
use crate::component::model::dav::instance::DavInstance;
use crate::component::rfc::dav::core::{CalendarFilter, CalendarQuery, CompFilter};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;

/// ## Summary
/// Finds instances in a collection that match the calendar-query filter.
///
/// ## Errors
/// Returns database errors if queries fail.
pub async fn find_matching_instances(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    query: &CalendarQuery,
) -> anyhow::Result<Vec<DavInstance>> {
    // Apply filter to get matching entity IDs
    let matching_entity_ids = if let Some(filter) = &query.filter {
        apply_calendar_filter(conn, filter).await?
    } else {
        // No filter - get all entities in the collection
        dav_instance::table
            .filter(dav_instance::collection_id.eq(collection_id))
            .filter(dav_instance::deleted_at.is_null())
            .select(dav_instance::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?
    };

    // Query instances by entity IDs and collection
    let mut query_builder = dav_instance::table
        .filter(dav_instance::collection_id.eq(collection_id))
        .filter(dav_instance::entity_id.eq_any(matching_entity_ids))
        .filter(dav_instance::deleted_at.is_null())
        .into_boxed();

    // Apply limit if present
    if let Some(limit) = query.limit {
        query_builder = query_builder.limit(i64::from(limit));
    }

    // Execute query
    let instances = query_builder
        .select(DavInstance::as_select())
        .load::<DavInstance>(conn)
        .await?;

    Ok(instances)
}

/// ## Summary
/// Applies a calendar filter to find matching entity IDs.
///
/// Evaluates component filters and time-range filters against the `cal_index`.
///
/// ## Errors
/// Returns errors if the filter structure is invalid.
async fn apply_calendar_filter(
    conn: &mut DbConnection<'_>,
    filter: &CalendarFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    // Calendar filter should have VCALENDAR as root
    if filter.component != "VCALENDAR" {
        return Err(anyhow::anyhow!(
            "Calendar filter must start with VCALENDAR component"
        ));
    }

    // Collect entity IDs from all component filters
    let mut entity_id_sets: Vec<Vec<uuid::Uuid>> = Vec::new();

    // Process nested component filters (VEVENT, VTODO, etc.)
    for comp_filter in &filter.filters {
        let entity_ids = apply_comp_filter(conn, comp_filter).await?;
        entity_id_sets.push(entity_ids);
    }

    // Union all entity IDs (any component filter matches)
    let mut matching_entity_ids: Vec<uuid::Uuid> =
        entity_id_sets.into_iter().flatten().collect();
    matching_entity_ids.sort_unstable();
    matching_entity_ids.dedup();

    Ok(matching_entity_ids)
}

/// ## Summary
/// Applies a component filter to find matching entity IDs.
///
/// Filters by component type (VEVENT, VTODO, etc.) and time-range.
///
/// ## Errors
/// Returns errors if the filter structure is invalid.
async fn apply_comp_filter(
    conn: &mut DbConnection<'_>,
    comp_filter: &CompFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let component_name = comp_filter.name.as_str();

    // Build query on cal_index
    let query = cal_index::table
        .filter(cal_index::component_type.eq(component_name))
        .filter(cal_index::deleted_at.is_null());

    // Get distinct entity IDs based on whether we have time-range filter
    let entity_ids = if let Some(time_range) = &comp_filter.time_range {
        let start = time_range.start;
        let end = time_range.end;
        
        let mut boxed_query = query.into_boxed();
        
        // Apply start constraint: event_end > range_start
        if let Some(range_start) = start {
            boxed_query = boxed_query.filter(
                cal_index::dtend_utc
                    .is_null()
                    .or(cal_index::dtend_utc.gt(range_start)),
            );
        }

        // Apply end constraint: event_start < range_end
        if let Some(range_end) = end {
            boxed_query = boxed_query.filter(
                cal_index::dtstart_utc
                    .is_null()
                    .or(cal_index::dtstart_utc.lt(range_end)),
            );
        }
        
        boxed_query
            .select(cal_index::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?
    } else {
        query
            .select(cal_index::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?
    };

    Ok(entity_ids)
}

