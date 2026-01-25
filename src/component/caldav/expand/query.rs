//! Query expansion and limiting for `CalDAV` reports.

use chrono::{DateTime as ChronoDateTime, Datelike, Timelike, Utc};

use crate::component::rfc::dav::core::TimeRange;
use crate::component::rfc::ical::core::{Component, DateTime, Property, Value};
use crate::component::rfc::ical::expand::{RecurrenceSet, TimezoneDatabase};
use crate::component::rfc::ical::parse::parse_rrule;

/// ## Summary
/// Determines if an instance should be expanded based on query parameters.
///
/// ## Side Effects
/// None - pure function.
#[must_use]
pub fn should_expand_instance(
    has_rrule: bool,
    expand_range: Option<&TimeRange>,
    limit_recurrence_range: Option<&TimeRange>,
) -> bool {
    // Only expand if:
    // 1. The component has an RRULE
    // 2. An expand range is specified
    has_rrule && expand_range.is_some() && limit_recurrence_range.is_none()
}

/// ## Summary
/// Expands a recurring calendar component into individual instances.
///
/// Returns a vector of expanded component instances, each representing a single
/// occurrence with DTSTART/DTEND adjusted and RRULE/RDATE/EXDATE removed.
///
/// ## Errors
/// Returns an error if expansion fails due to invalid RRULE or timezone issues.
pub fn expand_recurrence_set(
    component: &Component,
    expand_range: &TimeRange,
    tz_db: &TimezoneDatabase,
) -> anyhow::Result<Vec<Component>> {
    // Extract DTSTART
    let dtstart_prop = component
        .properties
        .iter()
        .find(|p| p.name == "DTSTART")
        .ok_or_else(|| anyhow::anyhow!("Missing DTSTART in component"))?;

    let dtstart = match &dtstart_prop.value {
        Value::Date(d) => DateTime::floating(d.year, d.month, d.day, 0, 0, 0),
        Value::DateTime(dt) => dt.clone(),
        _ => return Err(anyhow::anyhow!("Invalid DTSTART value")),
    };

    // Build recurrence set
    let mut recurrence_set = RecurrenceSet::new(dtstart);

    // Extract RRULE, RDATE, EXDATE
    extract_rrule(component, &mut recurrence_set)?;
    extract_rdate(component, &mut recurrence_set);
    extract_exdate(component, &mut recurrence_set);

    // Expand occurrences
    let occurrences = recurrence_set.expand(
        expand_range.start,
        expand_range.end,
        tz_db,
    )?;

    // Create an instance component for each occurrence
    let mut instances = Vec::new();
    for occurrence in occurrences {
        let instance = create_instance_component(component, occurrence, tz_db)?;
        instances.push(instance);
    }

    Ok(instances)
}

/// Extracts RRULE from component and adds it to the recurrence set.
fn extract_rrule(
    component: &Component,
    recurrence_set: &mut RecurrenceSet,
) -> anyhow::Result<()> {
    if let Some(rrule_prop) = component.properties.iter().find(|p| p.name == "RRULE") {
        if let Value::Recur(rrule) = &rrule_prop.value {
            *recurrence_set = recurrence_set.clone().with_rrule((**rrule).clone());
        } else if !rrule_prop.raw_value.is_empty() {
            // Try parsing from raw value
            let rrule = parse_rrule(&rrule_prop.raw_value, 0, 0)?;
            *recurrence_set = recurrence_set.clone().with_rrule(rrule);
        } else {
            // Value is neither a Recur type nor has raw value to parse
        }
    }
    Ok(())
}

/// Extracts RDATE values from component and adds them to the recurrence set.
fn extract_rdate(component: &Component, recurrence_set: &mut RecurrenceSet) {
    for prop in &component.properties {
        if prop.name == "RDATE" {
            match &prop.value {
                Value::DateTime(dt) => {
                    *recurrence_set = recurrence_set.clone().with_rdate(dt.clone());
                }
                Value::Date(d) => {
                    let dt = DateTime::floating(d.year, d.month, d.day, 0, 0, 0);
                    *recurrence_set = recurrence_set.clone().with_rdate(dt);
                }
                _ => {}
            }
        }
    }
}

/// Extracts EXDATE values from component and adds them to the recurrence set.
fn extract_exdate(component: &Component, recurrence_set: &mut RecurrenceSet) {
    for prop in &component.properties {
        if prop.name == "EXDATE" {
            match &prop.value {
                Value::DateTime(dt) => {
                    *recurrence_set = recurrence_set.clone().with_exdate(dt.clone());
                }
                Value::Date(d) => {
                    let dt = DateTime::floating(d.year, d.month, d.day, 0, 0, 0);
                    *recurrence_set = recurrence_set.clone().with_exdate(dt);
                }
                _ => {}
            }
        }
    }
}

/// ## Summary
/// Limits a recurring calendar component to a specific time range.
///
/// Returns the component with only the occurrences that fall within the range,
/// but preserves the RRULE structure (unlike expand which removes it).
///
/// ## Errors
/// Returns an error if the component is invalid.
pub fn limit_recurrence_set(
    component: &Component,
    _limit_range: &TimeRange,
    _tz_db: &TimezoneDatabase,
) -> anyhow::Result<Component> {
    // For limit-recurrence-set, we return the component as-is but with a note
    // that the server should only process instances within the range.
    // The actual filtering happens at the query level.
    
    // TODO: Implement proper limiting logic that adjusts RRULE UNTIL/COUNT
    // to match the requested range while preserving the recurrence structure.
    
    Ok(component.clone())
}

/// Creates an instance component from a master and an occurrence time.
fn create_instance_component(
    master: &Component,
    occurrence: ChronoDateTime<Utc>,
    _tz_db: &TimezoneDatabase,
) -> anyhow::Result<Component> {
    let mut instance = if let Some(kind) = master.kind {
        Component::new(kind)
    } else {
        return Err(anyhow::anyhow!("Master component has no kind"));
    };

    // Copy all properties except RRULE, RDATE, EXDATE
    for prop in &master.properties {
        match prop.name.as_str() {
            "RRULE" | "RDATE" | "EXDATE" => {
                // Skip recurrence properties
            }
            "DTSTART" => {
                // Replace DTSTART with occurrence time
                // These casts are intentional for converting chrono types to DateTime params
                #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                {
                    let dt = DateTime::utc(
                        occurrence.year() as u16,
                        occurrence.month() as u8,
                        occurrence.day() as u8,
                        occurrence.hour() as u8,
                        occurrence.minute() as u8,
                        occurrence.second() as u8,
                    );
                    instance.add_property(Property::datetime("DTSTART", dt));
                }
            }
            "DTEND" | "DURATION" => {
                // Adjust DTEND/DURATION relative to new DTSTART
                // TODO: Calculate proper end time based on duration
                instance.add_property(prop.clone());
            }
            _ => {
                // Copy other properties as-is
                instance.add_property(prop.clone());
            }
        }
    }

    // Add RECURRENCE-ID to identify this instance
    // These casts are intentional for converting chrono types to DateTime params
    #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    {
        let recurrence_id = DateTime::utc(
            occurrence.year() as u16,
            occurrence.month() as u8,
            occurrence.day() as u8,
            occurrence.hour() as u8,
            occurrence.minute() as u8,
            occurrence.second() as u8,
        );
        instance.add_property(Property::datetime("RECURRENCE-ID", recurrence_id));
    }

    // Copy child components (like VALARM)
    for child in &master.children {
        instance.add_child(child.clone());
    }

    Ok(instance)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::ical::core::RRule;
    use chrono::TimeZone;

    #[test]
    fn test_should_expand_with_rrule_and_range() {
        let expand_range = TimeRange {
            start: Some(Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap()),
            end: Some(Utc.with_ymd_and_hms(2024, 12, 31, 23, 59, 59).unwrap()),
        };
        
        assert!(should_expand_instance(true, Some(&expand_range), None));
    }

    #[test]
    fn test_should_not_expand_without_rrule() {
        let expand_range = TimeRange {
            start: Some(Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap()),
            end: Some(Utc.with_ymd_and_hms(2024, 12, 31, 23, 59, 59).unwrap()),
        };
        
        assert!(!should_expand_instance(false, Some(&expand_range), None));
    }

    #[test]
    fn test_should_not_expand_without_range() {
        assert!(!should_expand_instance(true, None, None));
    }

    #[test]
    fn test_should_not_expand_with_limit_recurrence() {
        let expand_range = TimeRange {
            start: Some(Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap()),
            end: Some(Utc.with_ymd_and_hms(2024, 12, 31, 23, 59, 59).unwrap()),
        };
        let limit_range = TimeRange {
            start: Some(Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap()),
            end: Some(Utc.with_ymd_and_hms(2024, 12, 31, 23, 59, 59).unwrap()),
        };
        
        assert!(!should_expand_instance(true, Some(&expand_range), Some(&limit_range)));
    }

    #[test]
    fn test_expand_basic_rrule() {
        let tz_db = TimezoneDatabase::new();
        
        let mut component = Component::event();
        let dtstart = DateTime::utc(2024, 1, 1, 10, 0, 0);
        component.add_property(Property::datetime("DTSTART", dtstart));
        component.add_property(Property::text("SUMMARY", "Daily Meeting"));
        
        let rrule = RRule::daily().with_count(3);
        let rrule_str = rrule.to_string();
        component.add_property(Property {
            name: "RRULE".to_string(),
            params: Vec::new(),
            value: Value::Recur(Box::new(rrule)),
            raw_value: rrule_str,
        });
        
        let expand_range = TimeRange {
            start: Some(Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap()),
            end: Some(Utc.with_ymd_and_hms(2024, 1, 31, 23, 59, 59).unwrap()),
        };
        
        let instances = expand_recurrence_set(&component, &expand_range, &tz_db).unwrap();
        
        // Should have 3 instances
        assert_eq!(instances.len(), 3);
        
        // Each instance should have RECURRENCE-ID
        for instance in &instances {
            assert!(instance.properties.iter().any(|p| p.name == "RECURRENCE-ID"));
            // Should not have RRULE
            assert!(!instance.properties.iter().any(|p| p.name == "RRULE"));
        }
    }
}
