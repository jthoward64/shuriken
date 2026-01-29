//! `CalDAV` filter evaluation for calendar-query reports.
//!
//! Implements filter logic for component-filter, time-range-filter,
//! and property-filter matching against calendar data.

use crate::db::connection::DbConnection;
use crate::db::query::text_match::{build_like_pattern, normalize_for_sql_upper};
use crate::db::schema::{cal_index, dav_instance, dav_parameter};
use crate::model::dav::instance::DavInstance;
use shuriken_rfc::rfc::dav::core::{
    CalendarFilter, CalendarQuery, CompFilter, MatchType, ParamFilter, TimeRange,
};
use chrono::TimeDelta;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use rrule::{RRule, Tz, Unvalidated};

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
/// Filters by component type (`VEVENT`, `VTODO`, etc.), time-range, and properties.
///
/// ## Errors
/// Returns errors if the filter structure is invalid.
#[expect(
    clippy::too_many_lines,
    reason = "Component filter logic handles multiple filter types cohesively"
)]
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

        let mut non_recurring_ids: Vec<uuid::Uuid> = Vec::new();
        let _recurring_ids: Vec<uuid::Uuid> = Vec::new();

        // Query non-recurring events from cal_index (rrule_text IS NULL)
        if start.is_some() || end.is_some() {
            let mut boxed_query = query.filter(cal_index::rrule_text.is_null()).into_boxed();

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

        let recurring_rows = query
            .filter(cal_index::rrule_text.is_not_null())
            .filter(cal_index::dtstart_utc.is_not_null())
            .select((
                cal_index::entity_id,
                cal_index::rrule_text,
                cal_index::dtstart_utc,
            ))
            .load::<(
                uuid::Uuid,
                Option<String>,
                Option<chrono::DateTime<chrono::Utc>>,
            )>(conn)
            .await?;

        let recurring_ids: Vec<uuid::Uuid> = recurring_rows
            .into_iter()
            .filter_map(|(entity_id, rrule_text, dtstart_utc)| {
                let rrule_text = rrule_text?;
                let dtstart_utc = dtstart_utc?;

                let rrule = rrule_text.parse::<RRule<Unvalidated>>().ok()?;
                let dt_start = dtstart_utc.with_timezone(&Tz::UTC);
                let mut rrule_set: rrule::RRuleSet = match rrule.build(dt_start) {
                    Ok(set) => set,
                    Err(_) => return None,
                };

                if let Some(range_start) = start {
                    let inclusive_start = range_start - TimeDelta::seconds(1);
                    rrule_set = rrule_set.after(inclusive_start.with_timezone(&Tz::UTC));
                }

                if let Some(range_end) = end {
                    rrule_set = rrule_set.before(range_end.with_timezone(&Tz::UTC));
                }

                let occurrences: Vec<chrono::DateTime<rrule::Tz>> = rrule_set.all(u16::MAX).dates;
                if occurrences.is_empty() {
                    None
                } else {
                    Some(entity_id)
                }
            })
            .collect();

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
    prop_filters: &[shuriken_rfc::rfc::dav::core::PropFilter],
) -> anyhow::Result<Vec<uuid::Uuid>> {
    use crate::db::schema::{dav_component, dav_property};

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
            // CalDAV defaults to i;ascii-casemap per RFC 4791 Section 7.5
            let effective_collation = text_match
                .collation
                .clone()
                .unwrap_or_else(|| "i;ascii-casemap".to_string());
            let collation = normalize_for_sql_upper(&text_match.value, Some(&effective_collation))?;
            let pattern = build_like_pattern(&collation.value, &text_match.match_type);

            let mut query = dav_component::table
                .inner_join(
                    dav_property::table.on(dav_property::component_id.eq(dav_component::id)),
                )
                .filter(dav_component::entity_id.eq_any(entity_ids))
                .filter(dav_property::name.eq(&prop_name))
                .filter(dav_property::deleted_at.is_null())
                .into_boxed();

            if let Some(time_range) = &prop_filter.time_range
                && let Some(filter_sql) = build_property_time_range_sql(time_range)
            {
                query = query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&filter_sql));
            }

            // Apply text matching based on collation and match type
            if collation.case_sensitive {
                // i;octet - case-sensitive comparison
                query = match text_match.match_type {
                    MatchType::Equals => {
                        query.filter(dav_property::value_text.eq(&collation.value))
                    }
                    MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => query
                        .filter(
                            dav_property::value_text
                                .like(build_like_pattern(&collation.value, &text_match.match_type)),
                        ),
                };
            } else {
                // Case-insensitive: use SQL UPPER() with pre-uppercased pattern
                query = match text_match.match_type {
                    MatchType::Equals => query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                        &format!("UPPER(value_text) = '{}'", collation.value),
                    )),
                    MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => query
                        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
                            "UPPER(value_text) LIKE '{pattern}'"
                        ))),
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
        } else if let Some(time_range) = &prop_filter.time_range {
            let mut query = dav_component::table
                .inner_join(
                    dav_property::table.on(dav_property::component_id.eq(dav_component::id)),
                )
                .filter(dav_component::entity_id.eq_any(entity_ids))
                .filter(dav_property::name.eq(&prop_name))
                .filter(dav_property::deleted_at.is_null())
                .into_boxed();

            if let Some(filter_sql) = build_property_time_range_sql(time_range) {
                query = query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&filter_sql));
            }

            query
                .select(dav_component::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?
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

        // Apply param-filters if present
        let matching_entity_ids = if prop_filter.param_filters.is_empty() {
            matching_entity_ids
        } else {
            apply_param_filters(
                conn,
                &matching_entity_ids,
                &prop_name,
                &prop_filter.param_filters,
                prop_filter.test,
            )
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

/// ## Summary
/// Builds a SQL filter for property-level time-range evaluation.
///
/// Matches values stored in either `value_tstz` or `value_date`.
fn build_property_time_range_sql(time_range: &TimeRange) -> Option<String> {
    let start = time_range.start;
    let end = time_range.end;

    if start.is_none() && end.is_none() {
        return None;
    }

    let mut tstz_parts = vec!["value_tstz IS NOT NULL".to_string()];
    if let Some(range_start) = start {
        let start_str = range_start.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        tstz_parts.push(format!("value_tstz >= '{start_str}'"));
    }
    if let Some(range_end) = end {
        let end_str = range_end.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        tstz_parts.push(format!("value_tstz < '{end_str}'"));
    }

    let mut date_parts = vec!["value_date IS NOT NULL".to_string()];
    if let Some(range_start) = start {
        let start_date = range_start.date_naive().format("%Y-%m-%d");
        date_parts.push(format!("value_date >= '{start_date}'"));
    }
    if let Some(range_end) = end {
        let end_date = range_end.date_naive().format("%Y-%m-%d");
        date_parts.push(format!("value_date < '{end_date}'"));
    }

    let tstz_clause = format!("({})", tstz_parts.join(" AND "));
    let date_clause = format!("({})", date_parts.join(" AND "));
    Some(format!("({tstz_clause} OR {date_clause})"))
}

/// ## Summary
/// Applies param-filters to further filter entity IDs.
///
/// Filters entities to only those that have properties matching the given
/// property name where the property has parameters matching the param-filters.
/// Uses `test` to determine if param-filters are AND-combined (`allof`) or OR-combined (`anyof`).
///
/// ## Errors
/// Returns database errors if queries fail.
#[expect(
    clippy::too_many_lines,
    reason = "Parameter filter logic requires cohesive handling of multiple filter modes"
)]
async fn apply_param_filters(
    conn: &mut DbConnection<'_>,
    entity_ids: &[uuid::Uuid],
    prop_name: &str,
    param_filters: &[ParamFilter],
    test: shuriken_rfc::rfc::dav::core::FilterTest,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    use crate::db::schema::{dav_component, dav_property};
    use shuriken_rfc::rfc::dav::core::FilterTest;

    if entity_ids.is_empty() || param_filters.is_empty() {
        return Ok(entity_ids.to_vec());
    }

    // Get all property IDs for the given property name and entities
    let prop_ids: Vec<(uuid::Uuid, uuid::Uuid)> = dav_component::table
        .inner_join(dav_property::table.on(dav_property::component_id.eq(dav_component::id)))
        .filter(dav_component::entity_id.eq_any(entity_ids))
        .filter(dav_property::name.eq(prop_name))
        .filter(dav_property::deleted_at.is_null())
        .filter(dav_component::deleted_at.is_null())
        .select((dav_component::entity_id, dav_property::id))
        .load::<(uuid::Uuid, uuid::Uuid)>(conn)
        .await?;

    if prop_ids.is_empty() {
        return Ok(Vec::new());
    }

    let all_prop_ids: std::collections::HashSet<uuid::Uuid> =
        prop_ids.iter().map(|(_, prop_id)| *prop_id).collect();

    // Collect matching property IDs for each param-filter
    let mut param_result_sets: Vec<std::collections::HashSet<uuid::Uuid>> = Vec::new();

    for param_filter in param_filters {
        let param_name = param_filter.name.to_uppercase();
        let props_matching_param = evaluate_single_param_filter(
            conn,
            &all_prop_ids.iter().copied().collect::<Vec<_>>(),
            &param_name,
            param_filter,
        )
        .await?;
        param_result_sets.push(props_matching_param);
    }

    // Combine results based on test mode
    let matching_prop_ids: std::collections::HashSet<uuid::Uuid> = match test {
        FilterTest::AllOf => {
            // Intersection: property must match ALL param-filters
            if param_result_sets.is_empty() {
                all_prop_ids
            } else {
                let mut result = param_result_sets[0].clone();
                for set in &param_result_sets[1..] {
                    result.retain(|id| set.contains(id));
                }
                result
            }
        }
        FilterTest::AnyOf => {
            // Union: property must match ANY param-filter
            param_result_sets.into_iter().flatten().collect()
        }
    };

    // Return entity IDs that have at least one matching property
    let matching_entities: Vec<uuid::Uuid> = prop_ids
        .into_iter()
        .filter(|(_, prop_id)| matching_prop_ids.contains(prop_id))
        .map(|(entity_id, _)| entity_id)
        .collect();

    let mut result: Vec<uuid::Uuid> = matching_entities.into_iter().collect();
    result.sort_unstable();
    result.dedup();
    Ok(result)
}

/// ## Summary
/// Evaluates a single param-filter against property IDs.
///
/// Returns property IDs that match the param-filter.
///
/// ## Errors
/// Returns database errors if queries fail.
#[expect(
    clippy::too_many_lines,
    reason = "Single param-filter evaluation has multiple code paths for match types"
)]
async fn evaluate_single_param_filter(
    conn: &mut DbConnection<'_>,
    prop_ids: &[uuid::Uuid],
    param_name: &str,
    param_filter: &ParamFilter,
) -> anyhow::Result<std::collections::HashSet<uuid::Uuid>> {
    // CalDAV defaults to i;ascii-casemap per RFC 4791 Section 7.5
    fn get_effective_collation(text_match: &shuriken_rfc::rfc::dav::core::TextMatch) -> String {
        text_match
            .collation
            .clone()
            .unwrap_or_else(|| "i;ascii-casemap".to_string())
    }

    if prop_ids.is_empty() {
        return Ok(std::collections::HashSet::new());
    }

    if param_filter.is_not_defined {
        // Parameter must NOT exist - find properties without this parameter
        let props_with_param: Vec<uuid::Uuid> = dav_parameter::table
            .filter(dav_parameter::property_id.eq_any(prop_ids))
            .filter(dav_parameter::name.eq(param_name))
            .filter(dav_parameter::deleted_at.is_null())
            .select(dav_parameter::property_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        let props_with_param_set: std::collections::HashSet<_> =
            props_with_param.into_iter().collect();

        // Return properties that DON'T have this parameter
        Ok(prop_ids
            .iter()
            .filter(|id| !props_with_param_set.contains(id))
            .copied()
            .collect())
    } else if let Some(text_match) = &param_filter.text_match {
        // Parameter must exist and match text
        let effective_collation = get_effective_collation(text_match);
        let collation = normalize_for_sql_upper(&text_match.value, Some(&effective_collation))?;
        let pattern = build_like_pattern(&collation.value, &text_match.match_type);

        let mut query = dav_parameter::table
            .filter(dav_parameter::property_id.eq_any(prop_ids))
            .filter(dav_parameter::name.eq(param_name))
            .filter(dav_parameter::deleted_at.is_null())
            .into_boxed();

        // Apply text matching
        if collation.case_sensitive {
            query = match text_match.match_type {
                MatchType::Equals => query.filter(dav_parameter::value.eq(&collation.value)),
                MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                    query.filter(dav_parameter::value.like(&pattern))
                }
            };
        } else {
            query = match text_match.match_type {
                MatchType::Equals => query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                    &format!("UPPER(value) = '{}'", collation.value),
                )),
                MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                    query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
                        "UPPER(value) LIKE '{pattern}'"
                    )))
                }
            };
        }

        let matched_prop_ids: Vec<uuid::Uuid> = query
            .select(dav_parameter::property_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        // Handle negate: return properties that DON'T match
        if text_match.negate {
            let matched_set: std::collections::HashSet<_> = matched_prop_ids.into_iter().collect();
            Ok(prop_ids
                .iter()
                .filter(|id| !matched_set.contains(id))
                .copied()
                .collect())
        } else {
            Ok(matched_prop_ids.into_iter().collect())
        }
    } else {
        // Parameter must exist (no text match specified)
        let props_with_param: Vec<uuid::Uuid> = dav_parameter::table
            .filter(dav_parameter::property_id.eq_any(prop_ids))
            .filter(dav_parameter::name.eq(param_name))
            .filter(dav_parameter::deleted_at.is_null())
            .select(dav_parameter::property_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        Ok(props_with_param.into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::query::text_match::normalize_for_sql_upper;

    #[test]
    fn test_normalize_text_unicode_casemap_basic() {
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_sql_upper("Hello World", collation.as_ref()).unwrap();
        assert_eq!(result.value, "HELLO WORLD");
        assert!(!result.case_sensitive);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_german_eszett() {
        // German ß should fold to ss, then uppercase to SS
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_sql_upper("Straße", collation.as_ref()).unwrap();
        assert_eq!(result.value, "STRASSE");
        assert!(!result.case_sensitive);

        // Verify ß comparison: "STRASSE" and "Straße" should match after folding+uppercase
        let upper = normalize_for_sql_upper("STRASSE", collation.as_ref()).unwrap();
        assert_eq!(result.value, upper.value);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_greek_sigma() {
        // Greek final sigma ς and regular sigma σ should fold to the same value
        let collation = Some("i;unicode-casemap".to_string());
        let final_sigma = normalize_for_sql_upper("Σ", collation.as_ref()).unwrap();
        let regular_sigma = normalize_for_sql_upper("σ", collation.as_ref()).unwrap();
        assert_eq!(final_sigma.value, regular_sigma.value);
    }

    #[test]
    fn test_normalize_text_octet_case_sensitive() {
        let collation = Some("i;octet".to_string());
        let result = normalize_for_sql_upper("Hello World", collation.as_ref()).unwrap();
        assert_eq!(result.value, "Hello World"); // Preserved exactly
        assert!(result.case_sensitive);
    }

    #[test]
    fn test_normalize_text_ascii_casemap() {
        let collation = Some("i;ascii-casemap".to_string());
        let result = normalize_for_sql_upper("Hello World", collation.as_ref()).unwrap();
        assert_eq!(result.value, "HELLO WORLD");
        assert!(!result.case_sensitive);
    }

    #[test]
    fn test_normalize_text_default_collation() {
        // None should default to unicode-casemap behavior
        let result = normalize_for_sql_upper("Straße", None).unwrap();
        assert_eq!(result.value, "STRASSE");
        assert!(!result.case_sensitive);
    }
}
