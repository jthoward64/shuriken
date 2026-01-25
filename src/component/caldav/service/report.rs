//! CalDAV REPORT service layer.

//! Business logic for calendar-query and calendar-multiget reports.

use crate::component::db::connection::DbConnection;
use crate::component::db::query::caldav::filter::find_matching_instances;
use crate::component::db::query::caldav::occurrence;
use crate::component::db::query::dav::instance;
use crate::component::db::query::report_property::build_instance_properties;
use crate::component::model::dav::instance::DavInstance;
use crate::component::model::dav::occurrence::CalOccurrence;
use crate::component::rfc::dav::core::{
    CalendarMultiget, CalendarQuery, Href, Multistatus, PropertyName, PropstatResponse, RecurrenceExpansion,
};
use crate::component::rfc::ical::core::{ComponentKind, ICalendar, Property};
use crate::component::rfc::ical::{build, parse};
use chrono::Utc;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;

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
            let href = Href::new(format!("/{}", instance.uri));
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
/// Retrieves specified calendar objects by href and builds a multistatus response.
///
/// ## Side Effects
/// Queries the database for each requested resource.
///
/// ## Errors
/// Returns database errors if queries fail.
pub async fn execute_calendar_multiget(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    multiget: &CalendarMultiget,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    let mut multistatus = Multistatus::new();

    // Process each href
    for href in &multiget.hrefs {
        let href_str = href.as_str();

        // Extract the resource URI from the href
        let Ok(uri) = crate::util::path::extract_resource_uri(href_str) else {
            // Invalid href format, return 404
            let response = PropstatResponse::not_found(href.clone());
            multistatus.add_response(response);
            continue;
        };

        // Query for instance by collection and URI
        let instance_opt = instance::by_collection_and_uri(collection_id, &uri)
            .select(DavInstance::as_select())
            .first::<DavInstance>(conn)
            .await
            .optional()?;

        if let Some(inst) = instance_opt {
            // Build requested properties for this instance
            let props = build_instance_properties(conn, &inst, properties).await?;
            let response = PropstatResponse::ok(href.clone(), props);
            multistatus.add_response(response);
        } else {
            // Resource not found
            let response = PropstatResponse::not_found(href.clone());
            multistatus.add_response(response);
        }
    }

    Ok(multistatus)
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
    time_range: &crate::component::rfc::dav::core::TimeRange,
    expansion_mode: RecurrenceExpansion,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    use crate::component::db::schema::dav_shadow;

    let mut multistatus = Multistatus::new();

    for instance in instances {
        // Load calendar data from shadow table
        let calendar_data: Option<Vec<u8>> = dav_shadow::table
            .filter(dav_shadow::entity_id.eq(instance.entity_id))
            .filter(dav_shadow::direction.eq("outbound"))
            .filter(dav_shadow::deleted_at.is_null())
            .select(dav_shadow::raw_canonical)
            .order(dav_shadow::updated_at.desc())
            .first::<Option<Vec<u8>>>(conn)
            .await
            .optional()?
            .flatten();

        let Some(bytes) = calendar_data else {
            continue;
        };

        let data = String::from_utf8_lossy(&bytes).into_owned();
        let ical = parse::parse(&data)
            .map_err(|e| anyhow::anyhow!("Failed to parse iCalendar: {e}"))?;

        // Check if any VEVENT has RRULE
        let has_recurrence = ical.root.children.iter()
            .any(|comp| comp.kind == Some(ComponentKind::Event) && comp.get_property("RRULE").is_some());

        if !has_recurrence {
            // Non-recurring event - return as-is
            let href = Href::new(format!("/{}", instance.uri));
            let props = build_instance_properties(conn, &instance, properties).await?;
            let response = PropstatResponse::ok(href, props);
            multistatus.add_response(response);
            continue;
        }

        // Query occurrences for this instance in the time range
        let range_start = time_range.start.unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
        let range_end = time_range.end.unwrap_or_else(|| Utc::now() + chrono::Duration::days(365));

        let occurrences = occurrence::by_time_range(range_start, range_end)
            .filter(crate::component::db::schema::cal_occurrence::entity_id.eq(instance.entity_id))
            .filter(crate::component::db::schema::cal_occurrence::deleted_at.is_null())
            .select(CalOccurrence::as_select())
            .load::<CalOccurrence>(conn)
            .await?;

        match expansion_mode {
            RecurrenceExpansion::Expand => {
                // Generate separate response for each occurrence
                for occ in occurrences {
                    let occurrence_href = if let Some(recurrence_id) = occ.recurrence_id_utc {
                        // Exception instance - use RECURRENCE-ID in href
                        Href::new(format!("/{}/{}",  instance.uri.trim_end_matches(".ics"),
                            recurrence_id.format("%Y%m%dT%H%M%SZ")))
                    } else {
                        // Regular occurrence - use instance URI + occurrence time
                        Href::new(format!("/{}/{}",  instance.uri.trim_end_matches(".ics"),
                            occ.start_utc.format("%Y%m%dT%H%M%SZ")))
                    };

                    // Create expanded calendar data for this occurrence
                    let expanded_ical = expand_occurrence_ical(&ical, &occ);
                    let expanded_content = build::serialize(&expanded_ical);

                    // Build properties with modified content
                    let props = build_expanded_occurrence_properties(
                        &expanded_content,
                        properties,
                    );

                    let response = PropstatResponse::ok(occurrence_href, props);
                    multistatus.add_response(response);
                }
            }
            RecurrenceExpansion::LimitRecurrenceSet => {
                // Return master event as-is (filtering already done in query)
                let href = Href::new(format!("/{}", instance.uri));
                let props = build_instance_properties(conn, &instance, properties).await?;
                let response = PropstatResponse::ok(href, props);
                multistatus.add_response(response);
            }
        }
    }

    Ok(multistatus)
}

/// ## Summary
/// Expands an iCalendar for a specific occurrence.
///
/// Creates a new iCalendar with DTSTART/DTEND adjusted to the occurrence time
/// and RRULE/EXDATE/RDATE properties removed.
fn expand_occurrence_ical(
    ical: &ICalendar,
    occurrence: &CalOccurrence,
) -> ICalendar {
    let mut expanded_ical = ical.clone();

    // Find and modify VEVENT components
    for component in &mut expanded_ical.root.children {
        if component.kind != Some(ComponentKind::Event) {
            continue;
        }

        // Remove recurrence properties
        component.properties.retain(|prop| {
            !matches!(
                prop.name.as_str(),
                "RRULE" | "EXDATE" | "RDATE" | "EXRULE"
            )
        });

        // Update DTSTART
        if let Some(dtstart_prop_idx) = component.properties.iter().position(|p| p.name == "DTSTART") {
            // Create new DTSTART property with occurrence time
            let dtstart_value = occurrence.start_utc.format("%Y%m%dT%H%M%SZ").to_string();
            component.properties[dtstart_prop_idx] = Property::text("DTSTART", &dtstart_value);
        }

        // Update DTEND
        if let Some(dtend_prop_idx) = component.properties.iter().position(|p| p.name == "DTEND") {
            let dtend_value = occurrence.end_utc.format("%Y%m%dT%H%M%SZ").to_string();
            component.properties[dtend_prop_idx] = Property::text("DTEND", &dtend_value);
        } else if component.get_property("DURATION").is_some() {
            // If DURATION is present, replace with DTEND
            component.properties.retain(|p| p.name != "DURATION");
            let dtend_value = occurrence.end_utc.format("%Y%m%dT%H%M%SZ").to_string();
            component.properties.push(Property::text("DTEND", &dtend_value));
        }

        // Add RECURRENCE-ID if this is an exception
        if let Some(recurrence_id) = occurrence.recurrence_id_utc {
            let recurrence_id_value = recurrence_id.format("%Y%m%dT%H%M%SZ").to_string();
            component.properties.push(Property::text("RECURRENCE-ID", &recurrence_id_value));
        }
    }

    expanded_ical
}

/// ## Summary
/// Builds properties for an expanded occurrence.
///
/// Similar to `build_instance_properties` but uses the expanded calendar data.
fn build_expanded_occurrence_properties(
    calendar_data: &str,
    properties: &[PropertyName],
) -> Vec<crate::component::rfc::dav::core::DavProperty> {
    use crate::component::rfc::dav::core::DavProperty;

    let mut props = Vec::new();

    for prop_name in properties {
        // Handle calendar-data property
        let qname = prop_name.qname();
        if qname.namespace_uri() == "urn:ietf:params:xml:ns:caldav" && qname.local_name() == "calendar-data" {
            props.push(DavProperty::xml(
                qname,
                calendar_data.to_string(),
            ));
        }
        // Other properties would need to be computed from the expanded data
        // For now, just include calendar-data which is the most common request
    }

    props
}
