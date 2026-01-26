//! `CalDAV` filter evaluation for calendar-query reports.
//!
//! Implements filter logic for component-filter, time-range-filter,
//! and property-filter matching against calendar data.

use crate::component::db::connection::DbConnection;
use crate::component::db::query::text_match::{build_like_pattern, normalize_for_sql_upper};
use crate::component::db::schema::{cal_index, dav_instance};
use crate::component::model::dav::instance::DavInstance;
use crate::component::rfc::dav::core::{CalendarFilter, CalendarQuery, CompFilter, MatchType};
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
    let mut matching_entity_ids: Vec<uuid::Uuid> = entity_id_sets.into_iter().flatten().collect();
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

        // For time-range queries, we need to check both:
        // 1. Non-recurring events in cal_index
        // 2. Recurring event occurrences in cal_occurrence

        let mut non_recurring_ids = Vec::new();
        let mut recurring_ids = Vec::new();

        // Query non-recurring events from cal_index (rrule_text IS NULL)
        if start.is_some() || end.is_some() {
            let mut boxed_query = query
                .clone()
                .filter(cal_index::rrule_text.is_null())
                .into_boxed();

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

            non_recurring_ids = boxed_query
                .select(cal_index::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?;
        }

        // Query recurring events from cal_occurrence table
        if start.is_some() || end.is_some() {
            use crate::component::db::schema::cal_occurrence;

            // First, get all recurring event entity IDs
            let recurring_event_ids: Vec<uuid::Uuid> = query
                .clone()
                .filter(cal_index::rrule_text.is_not_null())
                .select(cal_index::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?;

            if !recurring_event_ids.is_empty() {
                // Query occurrences within time range
                let mut occ_query = cal_occurrence::table
                    .filter(cal_occurrence::entity_id.eq_any(&recurring_event_ids))
                    .filter(cal_occurrence::deleted_at.is_null())
                    .into_boxed();

                // Apply start constraint: occurrence_end > range_start
                if let Some(range_start) = start {
                    occ_query = occ_query.filter(cal_occurrence::end_utc.gt(range_start));
                }

                // Apply end constraint: occurrence_start < range_end
                if let Some(range_end) = end {
                    occ_query = occ_query.filter(cal_occurrence::start_utc.lt(range_end));
                }

                recurring_ids = occ_query
                    .select(cal_occurrence::entity_id)
                    .distinct()
                    .load::<uuid::Uuid>(conn)
                    .await?;
            }
        }

        // Union non-recurring and recurring event IDs
        let mut combined_ids = non_recurring_ids;
        combined_ids.extend(recurring_ids);
        combined_ids.sort_unstable();
        combined_ids.dedup();

        combined_ids
    } else {
        query
            .select(cal_index::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?
    };

    // Apply property filters (if present)
    if !comp_filter.prop_filters.is_empty() {
        let prop_filtered_ids =
            apply_property_filters(conn, &entity_ids, &comp_filter.prop_filters).await?;
        entity_ids = prop_filtered_ids;
    }

    Ok(entity_ids)
}

/// ## Summary
/// Applies property filters to entity IDs.
///
/// Queries `dav_property` table to match properties by name and value.
/// Supports arbitrary iCalendar properties including X-* extensions.
///
/// ## Errors
/// Returns database errors if queries fail.
#[expect(
    clippy::too_many_lines,
    reason = "Property filter logic is complex but cohesive"
)]
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
                .inner_join(
                    dav_property::table.on(dav_property::component_id.eq(dav_component::id)),
                )
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
            let collation =
                normalize_for_sql_upper(&text_match.value, text_match.collation.as_ref());
            let pattern = build_like_pattern(&collation.value, &text_match.match_type);

            let mut query = dav_component::table
                .inner_join(
                    dav_property::table.on(dav_property::component_id.eq(dav_component::id)),
                )
                .filter(dav_component::entity_id.eq_any(entity_ids))
                .filter(dav_property::name.eq(&prop_name))
                .filter(dav_property::deleted_at.is_null())
                .into_boxed();

            // Apply text matching based on collation and match type
            if collation.case_sensitive {
                // i;octet - case-sensitive comparison
                query = match text_match.match_type {
                    MatchType::Equals => query.filter(dav_property::value_text.eq(&collation.value)),
                    MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                        query.filter(dav_property::value_text.like(build_like_pattern(
                            &collation.value,
                            &text_match.match_type,
                        )))
                    }
                };
            } else {
                // Case-insensitive: use SQL UPPER() with pre-uppercased pattern
                query = match text_match.match_type {
                    MatchType::Equals => query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                        &format!("UPPER(value_text) = '{}'", collation.value),
                    )),
                    MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                        query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
                            "UPPER(value_text) LIKE '{pattern}'"
                        )))
                    }
                };
            }

            let matched_ids = query
                .select(dav_component::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?;

            // Handle negate: return entities that DON'T match
            if text_match.negate {
                entity_ids
                    .iter()
                    .filter(|id| !matched_ids.contains(id))
                    .copied()
                    .collect()
            } else {
                matched_ids
            }
        } else {
            // Property must exist (no text match specified)
            dav_component::table
                .inner_join(
                    dav_property::table.on(dav_property::component_id.eq(dav_component::id)),
                )
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

#[cfg(test)]
mod tests {
    use crate::component::db::query::text_match::normalize_for_sql_upper;

    #[test]
    fn test_normalize_text_unicode_casemap_basic() {
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_sql_upper("Hello World", collation.as_ref());
        assert_eq!(result.value, "HELLO WORLD");
        assert!(!result.case_sensitive);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_german_eszett() {
        // German ß should fold to ss, then uppercase to SS
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_sql_upper("Straße", collation.as_ref());
        assert_eq!(result.value, "STRASSE");
        assert!(!result.case_sensitive);

        // Verify ß comparison: "STRASSE" and "Straße" should match after folding+uppercase
        let upper = normalize_for_sql_upper("STRASSE", collation.as_ref());
        assert_eq!(result.value, upper.value);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_greek_sigma() {
        // Greek final sigma ς and regular sigma σ should fold to the same value
        let collation = Some("i;unicode-casemap".to_string());
        let final_sigma = normalize_for_sql_upper("Σ", collation.as_ref());
        let regular_sigma = normalize_for_sql_upper("σ", collation.as_ref());
        assert_eq!(final_sigma.value, regular_sigma.value);
    }

    #[test]
    fn test_normalize_text_octet_case_sensitive() {
        let collation = Some("i;octet".to_string());
        let result = normalize_for_sql_upper("Hello World", collation.as_ref());
        assert_eq!(result.value, "Hello World"); // Preserved exactly
        assert!(result.case_sensitive);
    }

    #[test]
    fn test_normalize_text_ascii_casemap() {
        let collation = Some("i;ascii-casemap".to_string());
        let result = normalize_for_sql_upper("Hello World", collation.as_ref());
        assert_eq!(result.value, "HELLO WORLD");
        assert!(!result.case_sensitive);
    }

    #[test]
    fn test_normalize_text_default_collation() {
        // None should default to unicode-casemap behavior
        let result = normalize_for_sql_upper("Straße", None);
        assert_eq!(result.value, "STRASSE");
        assert!(!result.case_sensitive);
    }
}
