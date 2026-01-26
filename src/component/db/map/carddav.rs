//! DB <-> CardDAV mapping helpers.

use uuid::Uuid;

use crate::component::model::carddav::card_index::NewCardIndex;
use crate::component::rfc::vcard::VCard;

/// ## Summary
/// Builds a `NewCardIndex` from a parsed vCard and its entity ID.
///
/// Extracts indexable properties (UID, FN, N, ORG, TITLE) from the vCard
/// for efficient addressbook-query operations.
#[must_use]
pub fn build_card_index(entity_id: Uuid, vcard: &VCard) -> NewCardIndex<'_> {
    let uid = vcard.uid();
    let fn_ = vcard.formatted_name();
    
    // Extract N (structured name) components
    let (n_family, n_given) = vcard
        .name()
        .map_or((None, None), |name| {
            (
                name.family.first().map(String::as_str),
                name.given.first().map(String::as_str),
            )
        });
    
    // Extract ORG (organization) - use the main name
    let org = vcard
        .organization()
        .map(|org| org.name.as_str());
    
    let title = vcard.title();

    NewCardIndex {
        entity_id,
        uid,
        fn_,
        n_family,
        n_given,
        org,
        title,
    }
}
