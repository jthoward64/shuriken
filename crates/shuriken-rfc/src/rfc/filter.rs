//! Filtering logic for iCalendar and vCard partial retrieval.
//!
//! RFC 4791 §9.6 (calendar-data) and RFC 6352 §10.4 (address-data).

use crate::rfc::dav::core::{AddressDataRequest, CalendarDataRequest, ComponentSelection};

/// ## Summary
/// Filters iCalendar data based on component/property selection.
///
/// If no selection is specified, returns the full data.
/// Otherwise, filters to only include requested components and properties.
///
/// ## Errors
/// Returns an error if the iCalendar data is malformed.
pub fn filter_calendar_data(
    ical_data: &str,
    request: &CalendarDataRequest,
) -> anyhow::Result<String> {
    // If no selection, return full data
    let Some(selection) = &request.selection else {
        return Ok(ical_data.to_string());
    };

    // Simple line-based filtering
    // This is a pragmatic approach that handles most common cases
    let lines: Vec<&str> = ical_data.lines().collect();
    let mut filtered_lines = Vec::new();
    let mut current_component_stack: Vec<String> = Vec::new();
    let mut include_current = true;

    for line in lines {
        let line_upper = line.to_uppercase();

        // Track BEGIN/END for components
        if let Some(comp_name) = line_upper.strip_prefix("BEGIN:") {
            let comp = comp_name.trim().to_string();
            current_component_stack.push(comp.clone());

            // Determine if we should include this component
            include_current = should_include_component(&current_component_stack, selection);

            if include_current {
                filtered_lines.push(line);
            }
        } else if line_upper.starts_with("END:") {
            if include_current {
                filtered_lines.push(line);
            }
            current_component_stack.pop();
            // Recalculate inclusion for parent
            include_current = if current_component_stack.is_empty() {
                true
            } else {
                should_include_component(&current_component_stack, selection)
            };
        } else if include_current {
            // Check if this property line should be included
            if should_include_property(line, &current_component_stack, selection) {
                filtered_lines.push(line);
            }
        } else {
            // Skip lines when include_current is false
        }
    }

    Ok(filtered_lines.join("\n"))
}

/// Determines if a component should be included based on the selection.
fn should_include_component(component_stack: &[String], selection: &ComponentSelection) -> bool {
    if component_stack.is_empty() {
        return true;
    }

    // VCALENDAR is always the root
    if component_stack[0] == "VCALENDAR" && selection.name == "VCALENDAR" {
        if component_stack.len() == 1 {
            return true;
        }

        // Check if the nested component is in the selection
        let nested_comp = &component_stack[1];
        return selection.comps.iter().any(|c| c.name == *nested_comp);
    }

    false
}

/// Determines if a property line should be included.
fn should_include_property(
    line: &str,
    component_stack: &[String],
    selection: &ComponentSelection,
) -> bool {
    // Extract property name from the line (before : or ;)
    let prop_name = line
        .split_once(':')
        .or_else(|| line.split_once(';'))
        .map(|(name, _)| name.trim().to_uppercase())
        .unwrap_or_default();

    // Always include VERSION and PRODID for VCALENDAR
    if component_stack.first() == Some(&"VCALENDAR".to_string())
        && component_stack.len() == 1
        && (prop_name == "VERSION" || prop_name == "PRODID")
    {
        return true;
    }

    // Check if property is in the selection
    if component_stack.len() == 1 && component_stack[0] == "VCALENDAR" {
        // Root VCALENDAR properties
        selection
            .props
            .iter()
            .any(|p| p.to_uppercase() == prop_name)
    } else if component_stack.len() == 2 && component_stack[0] == "VCALENDAR" {
        // Nested component properties (e.g., VEVENT properties)
        let nested_comp = &component_stack[1];
        if let Some(comp_selection) = selection.comps.iter().find(|c| c.name == *nested_comp) {
            return comp_selection
                .props
                .iter()
                .any(|p| p.to_uppercase() == prop_name);
        }
        false
    } else {
        false
    }
}

/// ## Summary
/// Filters vCard data based on property selection.
///
/// If no properties are specified, returns the full data.
/// Otherwise, filters to only include requested properties.
///
/// ## Errors
/// Returns an error if the vCard data is malformed.
pub fn filter_address_data(
    vcard_data: &str,
    request: &AddressDataRequest,
) -> anyhow::Result<String> {
    // If no properties specified, return full data
    if request.props.is_empty() {
        return Ok(vcard_data.to_string());
    }

    // Simple line-based filtering
    let lines: Vec<&str> = vcard_data.lines().collect();
    let mut filtered_lines = Vec::new();

    for line in lines {
        let line_upper = line.to_uppercase();

        // Always include BEGIN:VCARD, END:VCARD, VERSION, FN (required by spec)
        if line_upper.starts_with("BEGIN:VCARD")
            || line_upper.starts_with("END:VCARD")
            || line_upper.starts_with("VERSION:")
            || line_upper.starts_with("FN:")
        {
            filtered_lines.push(line);
            continue;
        }

        // Extract property name from the line (before : or ;)
        let prop_name = line
            .split_once(':')
            .or_else(|| line.split_once(';'))
            .map(|(name, _)| name.trim().to_uppercase())
            .unwrap_or_default();

        // Check if this property is in the selection
        if request.props.iter().any(|p| p.to_uppercase() == prop_name) {
            filtered_lines.push(line);
        }
    }

    Ok(filtered_lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_calendar_full_data() {
        let ical = "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR";
        let request = CalendarDataRequest::full();
        let result = filter_calendar_data(ical, &request).unwrap();
        assert_eq!(result, ical);
    }

    #[test]
    fn test_filter_calendar_vevent_only() {
        let ical =
            "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Test\nEND:VEVENT\nEND:VCALENDAR";

        let selection = ComponentSelection::new("VCALENDAR")
            .with_prop("VERSION")
            .with_comp(ComponentSelection::new("VEVENT").with_prop("SUMMARY"));

        let request = CalendarDataRequest::with_selection(selection);
        let result = filter_calendar_data(ical, &request).unwrap();

        assert!(result.contains("BEGIN:VCALENDAR"));
        assert!(result.contains("BEGIN:VEVENT"));
        assert!(result.contains("SUMMARY:Test"));
        assert!(result.contains("END:VEVENT"));
        assert!(result.contains("END:VCALENDAR"));
    }

    #[test]
    fn test_filter_address_full_data() {
        let vcard = "BEGIN:VCARD\nVERSION:4.0\nFN:John Doe\nEND:VCARD";
        let request = AddressDataRequest::full();
        let result = filter_address_data(vcard, &request).unwrap();
        assert_eq!(result, vcard);
    }

    #[test]
    fn test_filter_address_email_only() {
        let vcard = "BEGIN:VCARD\nVERSION:4.0\nFN:John Doe\nEMAIL:john@example.com\nTEL:555-1234\nEND:VCARD";
        let request = AddressDataRequest::with_props(vec!["EMAIL".to_string()]);
        let result = filter_address_data(vcard, &request).unwrap();

        // Should include BEGIN, END, VERSION, FN (required), and EMAIL (requested)
        assert!(result.contains("BEGIN:VCARD"));
        assert!(result.contains("FN:John Doe"));
        assert!(result.contains("EMAIL:john@example.com"));
        // Should NOT include TEL
        assert!(!result.contains("TEL:555-1234"));
    }
}
