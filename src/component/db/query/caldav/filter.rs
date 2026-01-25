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
/// Filters by component type (VEVENT, VTODO, etc.), time-range, and properties.
///
/// ## Errors
/// Returns errors if the filter structure is invalid.
async fn apply_comp_filter(
    conn: &mut DbConnection<'_>,
    comp_filter: &CompFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let component_name = comp_filter.name.as_str();

    // Build base query on cal_index
    let query = cal_index::table
        .filter(cal_index::component_type.eq(component_name))
        .filter(cal_index::deleted_at.is_null());

    // Get entity IDs based on time-range filter (if present)
    let mut entity_ids = if let Some(time_range) = &comp_filter.time_range {
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

    // Apply property filters (if present)
    if !comp_filter.prop_filters.is_empty() {
        let prop_filtered_ids = apply_property_filters(conn, &entity_ids, &comp_filter.prop_filters).await?;
        entity_ids = prop_filtered_ids;
    }

    Ok(entity_ids)
}

/// ## Summary
/// Applies property filters to entity IDs.
///
/// Queries `dav_property` table to match properties by name and value.
///
/// ## Errors
/// Returns database errors if queries fail.
#[expect(clippy::too_many_lines, reason = "Property filter logic is complex but cohesive")]
async fn apply_property_filters(
    conn: &mut DbConnection<'_>,
    entity_ids: &[uuid::Uuid],
    prop_filters: &[crate::component::rfc::dav::core::PropFilter],
) -> anyhow::Result<Vec<uuid::Uuid>> {
    use crate::component::db::schema::{dav_component, dav_property};
    
    if entity_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut result_sets: Vec<Vec<uuid::Uuid>> = Vec::new();

    for prop_filter in prop_filters {
        let prop_name = prop_filter.name.to_uppercase();

        let matching_entity_ids = if prop_filter.is_not_defined {
            // Property must NOT exist - find entities without this property
            let entities_with_prop: Vec<uuid::Uuid> = dav_component::table
                .inner_join(dav_property::table.on(dav_property::component_id.eq(dav_component::id)))
                .filter(dav_component::entity_id.eq_any(entity_ids))
                .filter(dav_property::name.eq(&prop_name))
                .filter(dav_property::deleted_at.is_null())
                .select(dav_component::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?;

            // Return entities that DON'T have this property
            entity_ids
                .iter()
                .filter(|id| !entities_with_prop.contains(id))
                .copied()
                .collect()
        } else if let Some(text_match) = &prop_filter.text_match {
            // Property must exist and match text
            let match_value = text_match.value.to_uppercase();
            let case_sensitive = text_match.collation.as_deref() == Some("i;octet");

            let mut query = dav_component::table
                .inner_join(dav_property::table.on(dav_property::component_id.eq(dav_component::id)))
                .filter(dav_component::entity_id.eq_any(entity_ids))
                .filter(dav_property::name.eq(&prop_name))
                .filter(dav_property::deleted_at.is_null())
                .into_boxed();

            // Apply text matching based on match type
            query = match text_match.match_type {
                crate::component::rfc::dav::core::MatchType::Equals => {
                    if case_sensitive {
                        query.filter(dav_property::value_text.eq(&match_value))
                    } else {
                        query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                            &format!("UPPER(value_text) = '{match_value}'")
                        ))
                    }
                }
                crate::component::rfc::dav::core::MatchType::Contains => {
                    if case_sensitive {
                        query.filter(dav_property::value_text.like(format!("%{match_value}%")))
                    } else {
                        query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                            &format!("UPPER(value_text) LIKE '%{match_value}%'")
                        ))
                    }
                }
                crate::component::rfc::dav::core::MatchType::StartsWith => {
                    if case_sensitive {
                        query.filter(dav_property::value_text.like(format!("{match_value}%")))
                    } else {
                        query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                            &format!("UPPER(value_text) LIKE '{match_value}%'")
                        ))
                    }
                }
                crate::component::rfc::dav::core::MatchType::EndsWith => {
                    if case_sensitive {
                        query.filter(dav_property::value_text.like(format!("%{match_value}")))
                    } else {
                        query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                            &format!("UPPER(value_text) LIKE '%{match_value}'")
                        ))
                    }
                }
            };

            query
                .select(dav_component::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?
        } else {
            // Property must exist (no text match specified)
            dav_component::table
                .inner_join(dav_property::table.on(dav_property::component_id.eq(dav_component::id)))
                .filter(dav_component::entity_id.eq_any(entity_ids))
                .filter(dav_property::name.eq(&prop_name))
                .filter(dav_property::deleted_at.is_null())
                .select(dav_component::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?
        };

        result_sets.push(matching_entity_ids);
    }

    // Intersect all result sets (AND logic - all property filters must match)
    if result_sets.is_empty() {
        return Ok(entity_ids.to_vec());
    }

    let mut final_ids = result_sets[0].clone();
    for set in &result_sets[1..] {
        final_ids.retain(|id| set.contains(id));
    }

    Ok(final_ids)
}

