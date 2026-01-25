//! Round-trip parsing and serialization tests for vCard.
//!
//! These tests verify that vCards can be parsed and serialized back without
//! losing structural information.

use super::fixtures::*;
use crate::component::rfc::vcard::build::serialize_single;
use crate::component::rfc::vcard::parse::parse_single;

/// Parse a vCard, serialize it, then parse again and compare.
fn round_trip(input: &str) -> Result<(), String> {
    // First parse
    let vcard1 = parse_single(input).map_err(|e| format!("First parse failed: {e}"))?;

    // Serialize
    let serialized = serialize_single(&vcard1);

    // Second parse
    let vcard2 =
        parse_single(&serialized).map_err(|e| format!("Second parse failed: {e}\n{serialized}"))?;

    // Compare versions
    if vcard1.version != vcard2.version {
        return Err(format!(
            "Version mismatch: {:?} vs {:?}",
            vcard1.version, vcard2.version
        ));
    }

    // Compare property counts
    if vcard1.properties.len() != vcard2.properties.len() {
        return Err(format!(
            "Property count mismatch: {} vs {}",
            vcard1.properties.len(),
            vcard2.properties.len()
        ));
    }

    // Compare each property by name (order-independent check)
    let props1: std::collections::HashSet<&str> =
        vcard1.properties.iter().map(|p| p.name.as_str()).collect();
    let props2: std::collections::HashSet<&str> =
        vcard2.properties.iter().map(|p| p.name.as_str()).collect();

    if props1 != props2 {
        return Err(format!("Property names mismatch: {props1:?} vs {props2:?}"));
    }

    Ok(())
}

#[test]
fn round_trip_author_vcard() {
    round_trip(VCARD_AUTHOR).expect("round trip should succeed");
}

#[test]
fn round_trip_basic_vcard() {
    round_trip(VCARD_BASIC).expect("round trip should succeed");
}

#[test]
fn round_trip_structured_name() {
    round_trip(VCARD_STRUCTURED_NAME).expect("round trip should succeed");
}

#[test]
fn round_trip_organization() {
    round_trip(VCARD_ORGANIZATION).expect("round trip should succeed");
}

#[test]
fn round_trip_addresses() {
    round_trip(VCARD_ADDRESSES).expect("round trip should succeed");
}

#[test]
fn round_trip_categories() {
    round_trip(VCARD_CATEGORIES).expect("round trip should succeed");
}

#[test]
fn round_trip_note() {
    round_trip(VCARD_NOTE).expect("round trip should succeed");
}

#[test]
fn round_trip_dates() {
    round_trip(VCARD_DATES).expect("round trip should succeed");
}

#[test]
fn round_trip_urls() {
    round_trip(VCARD_URLS).expect("round trip should succeed");
}

#[test]
fn round_trip_uid() {
    round_trip(VCARD_UID).expect("round trip should succeed");
}

#[test]
fn round_trip_related() {
    round_trip(VCARD_RELATED).expect("round trip should succeed");
}

#[test]
fn round_trip_v3() {
    round_trip(VCARD_V3).expect("round trip should succeed");
}

#[test]
fn round_trip_gender() {
    round_trip(VCARD_GENDER).expect("round trip should succeed");
}

#[test]
fn round_trip_timezone() {
    round_trip(VCARD_TIMEZONE).expect("round trip should succeed");
}

#[test]
fn round_trip_email_pref() {
    round_trip(VCARD_EMAIL_PREF).expect("round trip should succeed");
}

#[test]
fn round_trip_impp() {
    round_trip(VCARD_IMPP).expect("round trip should succeed");
}

#[test]
fn round_trip_special_characters() {
    let vcard = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Test\\, Escape\\; Characters\r\n\
N:Characters;Test\\, Escape\\;;;;\r\n\
END:VCARD\r\n";
    round_trip(vcard).expect("round trip should succeed");
}

#[test]
fn round_trip_unicode() {
    let vcard = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:田中太郎\r\n\
N:田中;太郎;;;\r\n\
NOTE:日本語のメモ\r\n\
END:VCARD\r\n";
    round_trip(vcard).expect("round trip should succeed");
}

#[test]
fn round_trip_long_value() {
    let long_note = "A".repeat(200);
    let vcard = format!(
        "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Long Note Test\r\n\
N:Test;Long;Note;;\r\n\
NOTE:{long_note}\r\n\
END:VCARD\r\n"
    );
    round_trip(&vcard).expect("round trip should succeed");
}
