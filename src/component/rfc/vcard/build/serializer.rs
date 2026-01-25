//! vCard serialization.

use super::escape::{escape_component, escape_param_value, escape_text};
use super::fold::fold_line;
use crate::component::rfc::vcard::core::{
    Address, DateAndOrTime, Gender, Organization, StructuredName, VCard, VCardDate, VCardParameter,
    VCardProperty, VCardTime, VCardUtcOffset, VCardValue,
};
use std::fmt::Write as _;
/// Serializes one or more vCards to a string.
///
/// ## Summary
/// Produces RFC 6350 compliant vCard output with proper
/// line folding and escaping.
#[must_use]
pub fn serialize(cards: &[VCard]) -> String {
    let mut output = String::new();

    for card in cards {
        serialize_vcard(card, &mut output);
    }

    output
}

/// Serializes a single vCard to a string.
#[must_use]
pub fn serialize_single(card: &VCard) -> String {
    let mut output = String::new();
    serialize_vcard(card, &mut output);
    output
}

fn serialize_vcard(card: &VCard, output: &mut String) {
    // BEGIN:VCARD
    output.push_str("BEGIN:VCARD\r\n");

    // VERSION must be first after BEGIN
    output.push_str("VERSION:");
    output.push_str(card.version.as_str());
    output.push_str("\r\n");

    // Serialize properties in canonical order for stable ETags
    let ordered_props = canonical_property_order(&card.properties);

    for prop in ordered_props {
        serialize_property(prop, output);
    }

    // END:VCARD
    output.push_str("END:VCARD\r\n");
}

/// Returns properties in canonical order for deterministic output.
fn canonical_property_order(props: &[VCardProperty]) -> Vec<&VCardProperty> {
    let mut ordered: Vec<&VCardProperty> = props.iter().collect();

    // Sort by: group (None first), then name, then by order of appearance (stable sort)
    ordered.sort_by(|a, b| {
        // Group comparison (None < Some)
        match (&a.group, &b.group) {
            (None, Some(_)) => std::cmp::Ordering::Less,
            (Some(_), None) => std::cmp::Ordering::Greater,
            (Some(g1), Some(g2)) => {
                let cmp = g1.cmp(g2);
                if cmp != std::cmp::Ordering::Equal {
                    return cmp;
                }
                a.name.cmp(&b.name)
            }
            (None, None) => {
                // Sort by property name priority
                let pri_a = property_priority(&a.name);
                let pri_b = property_priority(&b.name);
                pri_a.cmp(&pri_b)
            }
        }
    });

    ordered
}

/// Returns priority for property ordering (lower = earlier).
fn property_priority(name: &str) -> u8 {
    match name {
        "FN" => 1,
        "N" => 2,
        "KIND" => 3,
        "NICKNAME" => 4,
        "PHOTO" => 10,
        "BDAY" => 11,
        "ANNIVERSARY" => 12,
        "GENDER" => 13,
        "ADR" => 20,
        "TEL" => 30,
        "EMAIL" => 31,
        "IMPP" => 32,
        "LANG" => 33,
        "TZ" => 40,
        "GEO" => 41,
        "TITLE" => 50,
        "ROLE" => 51,
        "LOGO" => 52,
        "ORG" => 53,
        "MEMBER" => 54,
        "RELATED" => 55,
        "CATEGORIES" => 60,
        "NOTE" => 61,
        "PRODID" => 70,
        "REV" => 71,
        "SOUND" => 72,
        "UID" => 73,
        "CLIENTPIDMAP" => 74,
        "URL" => 75,
        "KEY" => 80,
        "FBURL" => 90,
        "CALADRURI" => 91,
        "CALURI" => 92,
        _ => 100, // Extension properties
    }
}

fn serialize_property(prop: &VCardProperty, output: &mut String) {
    let mut line = String::new();

    // Group prefix
    if let Some(ref group) = prop.group {
        line.push_str(group);
        line.push('.');
    }

    // Property name
    line.push_str(&prop.name);

    // Parameters
    for param in &prop.params {
        serialize_parameter(param, &mut line);
    }

    // Value
    line.push(':');
    serialize_value(&prop.value, &prop.raw_value, &mut line);

    // Fold and add to output
    output.push_str(&fold_line(&line));
    output.push_str("\r\n");
}

fn serialize_parameter(param: &VCardParameter, output: &mut String) {
    output.push(';');
    output.push_str(&param.name);
    output.push('=');

    if param.values.is_empty() {
        return;
    }

    for (i, value) in param.values.iter().enumerate() {
        if i > 0 {
            output.push(',');
        }

        let (escaped, needs_quotes) = escape_param_value(value);

        if needs_quotes {
            output.push('"');
            output.push_str(&escaped);
            output.push('"');
        } else {
            output.push_str(&escaped);
        }
    }
}

#[expect(clippy::too_many_lines)]
fn serialize_value(value: &VCardValue, raw_value: &str, output: &mut String) {
    match value {
        VCardValue::Text(s) => {
            output.push_str(&escape_text(s));
        }
        VCardValue::TextList(list) => {
            for (i, s) in list.iter().enumerate() {
                if i > 0 {
                    output.push(',');
                }
                output.push_str(&escape_component(s));
            }
        }
        VCardValue::Uri(s) => {
            // URIs are not escaped
            output.push_str(s);
        }
        VCardValue::StructuredName(name) => {
            serialize_structured_name(name, output);
        }
        VCardValue::Address(addr) => {
            serialize_address(addr, output);
        }
        VCardValue::Organization(org) => {
            serialize_organization(org, output);
        }
        VCardValue::Gender(gender) => {
            serialize_gender(gender, output);
        }
        VCardValue::DateAndOrTime(dt) => {
            serialize_date_and_or_time(dt, output);
        }
        VCardValue::Timestamp(ts) => {
            output.push_str(&ts.datetime.format("%Y%m%dT%H%M%SZ").to_string());
        }
        VCardValue::Boolean(b) => {
            output.push_str(if *b { "true" } else { "false" });
        }
        VCardValue::Integer(i) => {
            output.push_str(&i.to_string());
        }
        VCardValue::Float(f) => {
            output.push_str(&f.to_string());
        }
        VCardValue::UtcOffset(offset) => {
            serialize_utc_offset(*offset, output);
        }
        VCardValue::LanguageTag(s) | VCardValue::Unknown(s) => {
            output.push_str(s);
        }
        VCardValue::Binary(_) => {
            // Use raw value for binary (assumed to be base64 encoded)
            output.push_str(raw_value);
        }
        VCardValue::ClientPidMap(cpm) => {
            output.push_str(&cpm.source_id.to_string());
            output.push(';');
            output.push_str(&cpm.uri);
        }
        VCardValue::Related(rel) => match rel {
            crate::component::rfc::vcard::core::Related::Uri(s) => output.push_str(s),
            crate::component::rfc::vcard::core::Related::Text(s) => {
                output.push_str(&escape_text(s));
            }
        },
    }
}

fn serialize_structured_name(name: &StructuredName, output: &mut String) {
    // family;given;additional;prefixes;suffixes
    serialize_component_list(&name.family, output);
    output.push(';');
    serialize_component_list(&name.given, output);
    output.push(';');
    serialize_component_list(&name.additional, output);
    output.push(';');
    serialize_component_list(&name.prefixes, output);
    output.push(';');
    serialize_component_list(&name.suffixes, output);
}

fn serialize_address(addr: &Address, output: &mut String) {
    // POBox;Extended;Street;Locality;Region;PostalCode;Country
    serialize_component_list(&addr.po_box, output);
    output.push(';');
    serialize_component_list(&addr.extended, output);
    output.push(';');
    serialize_component_list(&addr.street, output);
    output.push(';');
    serialize_component_list(&addr.locality, output);
    output.push(';');
    serialize_component_list(&addr.region, output);
    output.push(';');
    serialize_component_list(&addr.postal_code, output);
    output.push(';');
    serialize_component_list(&addr.country, output);
}

fn serialize_organization(org: &Organization, output: &mut String) {
    output.push_str(&escape_component(&org.name));
    for unit in &org.units {
        output.push(';');
        output.push_str(&escape_component(unit));
    }
}

fn serialize_gender(gender: &Gender, output: &mut String) {
    if let Some(sex) = &gender.sex {
        output.push(sex.as_char());
    }
    if let Some(ref identity) = gender.identity {
        output.push(';');
        output.push_str(&escape_text(identity));
    }
}

fn serialize_component_list(list: &[String], output: &mut String) {
    for (i, s) in list.iter().enumerate() {
        if i > 0 {
            output.push(',');
        }
        output.push_str(&escape_component(s));
    }
}

fn serialize_date_and_or_time(dt: &DateAndOrTime, output: &mut String) {
    match dt {
        DateAndOrTime::Date(date) => {
            serialize_date(date, output);
        }
        DateAndOrTime::DateTime { date, time, offset } => {
            serialize_date(date, output);
            output.push('T');
            serialize_time(time, output);
            if let Some(off) = offset {
                serialize_utc_offset(*off, output);
            }
        }
        DateAndOrTime::Time { time, offset } => {
            output.push('T');
            serialize_time(time, output);
            if let Some(off) = offset {
                serialize_utc_offset(*off, output);
            }
        }
        DateAndOrTime::Text(s) => {
            output.push_str(s);
        }
    }
}

fn serialize_date(date: &VCardDate, output: &mut String) {
    match date {
        VCardDate::Full(d) => {
            write!(output, "{}", d.format("%Y%m%d")).ok();
        }
        VCardDate::YearMonth { year, month } => {
            write!(output, "{year:04}-{month:02}").ok();
        }
        VCardDate::Year(year) => {
            write!(output, "{year:04}").ok();
        }
        VCardDate::MonthDay { month, day } => {
            write!(output, "--{month:02}{day:02}").ok();
        }
        VCardDate::Day(day) => {
            write!(output, "---{day:02}").ok();
        }
    }
}

fn serialize_time(time: &VCardTime, output: &mut String) {
    match time {
        VCardTime::Full(t) => {
            write!(output, "{}", t.format("%H%M%S")).ok();
        }
        VCardTime::HourMinute { hour, minute } => {
            write!(output, "{hour:02}{minute:02}").ok();
        }
        VCardTime::Hour(hour) => {
            write!(output, "{hour:02}").ok();
        }
        VCardTime::MinuteSecond { minute, second } => {
            write!(output, "-{minute:02}{second:02}").ok();
        }
        VCardTime::Second(second) => {
            write!(output, "--{second:02}").ok();
        }
    }
}

fn serialize_utc_offset(offset: VCardUtcOffset, output: &mut String) {
    if offset.hours == 0 && offset.minutes == 0 {
        output.push('Z');
    } else {
        let sign = if offset.hours >= 0 { '+' } else { '-' };
        output.push(sign);
        write!(output, "{:02}{:02}", offset.hours.abs(), offset.minutes).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::vcard::core::{VCard, VCardProperty, VCardVersion};

    #[test]
    fn serialize_simple_vcard() {
        let mut card = VCard::new();
        card.add_property(VCardProperty::text("FN", "John Doe"));

        let output = serialize_single(&card);

        assert!(output.starts_with("BEGIN:VCARD\r\n"));
        assert!(output.contains("VERSION:4.0\r\n"));
        assert!(output.contains("FN:John Doe\r\n"));
        assert!(output.ends_with("END:VCARD\r\n"));
    }

    #[test]
    fn serialize_v3_vcard() {
        let mut card = VCard::with_version(VCardVersion::V3);
        card.add_property(VCardProperty::text("FN", "John Doe"));

        let output = serialize_single(&card);
        assert!(output.contains("VERSION:3.0\r\n"));
    }

    #[test]
    fn serialize_with_group() {
        let mut card = VCard::new();
        card.add_property(VCardProperty::grouped_text(
            "item1",
            "TEL",
            "+1-555-555-5555",
        ));

        let output = serialize_single(&card);
        assert!(output.contains("item1.TEL:+1-555-555-5555\r\n"));
    }

    #[test]
    fn serialize_with_parameters() {
        let mut card = VCard::new();
        let mut prop = VCardProperty::text("TEL", "+1-555-555-5555");
        prop.add_type("home");
        prop.add_type("voice");
        prop.add_param(VCardParameter::pref(1));
        card.add_property(prop);

        let output = serialize_single(&card);
        assert!(output.contains("TEL;TYPE=home,voice;PREF=1:+1-555-555-5555\r\n"));
    }

    #[test]
    fn serialize_escapes_text() {
        let mut card = VCard::new();
        card.add_property(VCardProperty::text(
            "NOTE",
            "Line1\nLine2; with special, chars",
        ));

        let output = serialize_single(&card);
        assert!(output.contains("NOTE:Line1\\nLine2\\; with special\\, chars\r\n"));
    }

    #[test]
    fn serialize_structured_name() {
        let mut card = VCard::new();
        let name = StructuredName::simple("Doe", "John");
        card.add_property(VCardProperty {
            group: None,
            name: "N".to_string(),
            params: Vec::new(),
            value: VCardValue::StructuredName(name),
            raw_value: "Doe;John;;;".to_string(),
        });

        let output = serialize_single(&card);
        assert!(output.contains("N:Doe;John;;;\r\n"));
    }

    #[test]
    fn serialize_multiple_vcards() {
        let cards = vec![
            {
                let mut c = VCard::new();
                c.add_property(VCardProperty::text("FN", "John Doe"));
                c
            },
            {
                let mut c = VCard::new();
                c.add_property(VCardProperty::text("FN", "Jane Doe"));
                c
            },
        ];

        let output = serialize(&cards);

        let begin_count = output.matches("BEGIN:VCARD").count();
        let end_count = output.matches("END:VCARD").count();

        assert_eq!(begin_count, 2);
        assert_eq!(end_count, 2);
    }

    #[test]
    fn serialize_folds_long_lines() {
        let mut card = VCard::new();
        let long_value = "X".repeat(100);
        card.add_property(VCardProperty::text("NOTE", &long_value));

        let output = serialize_single(&card);
        assert!(output.contains("\r\n "));
    }
}
