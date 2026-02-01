//! DB <-> CardDAV mapping helpers.

use uuid::Uuid;

use crate::db::carddav_keys::{
    KEY_EMAILS, KEY_N_FAMILY, KEY_N_GIVEN, KEY_ORG, KEY_PHONES, KEY_TITLE, insert_string,
    insert_string_array,
};
use crate::model::carddav::card_index::NewCardIndex;
use shuriken_rfc::rfc::vcard::VCard;

/// ## Summary
/// Builds a `NewCardIndex` from a parsed vCard and its entity ID.
///
/// Extracts indexable properties (UID, FN) and all other data into JSONB
/// for efficient addressbook-query operations.
#[must_use]
pub fn build_card_index(entity_id: Uuid, vcard: &VCard) -> NewCardIndex {
    let uid = vcard.uid().map(String::from);
    let fn_ = vcard.formatted_name().map(String::from);

    // Build data JSONB object with all structured data
    let mut data = serde_json::json!({});

    // Extract N (structured name) components
    if let Some(name) = vcard.name() {
        if let Some(family) = name.family.first() {
            insert_string(&mut data, KEY_N_FAMILY, family.clone());
        }
        if let Some(given) = name.given.first() {
            insert_string(&mut data, KEY_N_GIVEN, given.clone());
        }
    }

    // Extract ORG (organization)
    if let Some(org) = vcard.organization() {
        insert_string(&mut data, KEY_ORG, org.name.clone());
    }

    // Extract TITLE
    if let Some(title) = vcard.title() {
        insert_string(&mut data, KEY_TITLE, title.to_string());
    }

    // Extract all EMAIL properties as array
    let emails: Vec<String> = vcard
        .emails()
        .into_iter()
        .map(std::string::ToString::to_string)
        .collect();
    insert_string_array(&mut data, KEY_EMAILS, emails);

    // Extract all TEL properties as array
    let phones: Vec<String> = vcard
        .telephones()
        .into_iter()
        .map(std::string::ToString::to_string)
        .collect();
    insert_string_array(&mut data, KEY_PHONES, phones);

    NewCardIndex {
        entity_id,
        uid,
        fn_,
        data: Some(data),
    }
}

#[cfg(test)]
mod tests {
    use super::build_card_index;
    use crate::db::carddav_keys::{
        KEY_EMAILS, KEY_N_FAMILY, KEY_N_GIVEN, KEY_ORG, KEY_PHONES, KEY_TITLE,
    };
    use shuriken_rfc::rfc::vcard::parse::parse_single;
    use uuid::Uuid;

    #[test]
    fn build_card_index_maps_json_keys_and_arrays() {
        let vcard = r"BEGIN:VCARD
VERSION:4.0
UID:test@example.com
FN:John Doe
N:Doe;John;;;
ORG:Example Inc.
TITLE:Engineer
EMAIL:John.Doe@EXAMPLE.COM
EMAIL:alt@example.com
TEL:+1-555-0100
END:VCARD";

        let card = parse_single(vcard).expect("vCard parse");
        let index = build_card_index(Uuid::nil(), &card);
        let data = index.data.expect("data json");

        assert_eq!(data[KEY_N_FAMILY], "Doe");
        assert_eq!(data[KEY_N_GIVEN], "John");
        assert_eq!(data[KEY_ORG], "Example Inc.");
        assert_eq!(data[KEY_TITLE], "Engineer");

        let emails = data[KEY_EMAILS].as_array().expect("emails array");
        assert_eq!(emails.len(), 2);

        let phones = data[KEY_PHONES].as_array().expect("phones array");
        assert_eq!(phones.len(), 1);
    }
}
