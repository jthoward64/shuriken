//! `CardDAV` filter evaluation for addressbook-query reports.
//!
//! Implements filter logic for property-filter and text-match
//! matching against vCard data.

use crate::component::db::connection::DbConnection;
use crate::component::db::schema::{card_email, card_index, card_phone, dav_instance};
use crate::component::model::dav::instance::DavInstance;
use crate::component::rfc::dav::core::{
    AddressbookFilter, AddressbookQuery, FilterTest, MatchType, PropFilter, TextMatch,
};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use icu::casemap::CaseMapper;

/// ## Summary
/// Finds instances in a collection that match the addressbook-query filter.
///
/// ## Errors
/// Returns database errors if queries fail.
pub async fn find_matching_instances(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    query: &AddressbookQuery,
) -> anyhow::Result<Vec<DavInstance>> {
    // Start with instances in the collection
    let base_query = dav_instance::table
        .filter(dav_instance::collection_id.eq(collection_id))
        .filter(dav_instance::deleted_at.is_null())
        .into_boxed();

    // Apply filter if present
    let instances = if let Some(filter) = &query.filter {
        apply_addressbook_filter(conn, base_query, filter, query.limit).await?
    } else {
        // No filter - return all instances (with limit)
        let mut query_builder = base_query;
        if let Some(limit) = query.limit {
            query_builder = query_builder.limit(i64::from(limit));
        }
        query_builder
            .select(DavInstance::as_select())
            .load::<DavInstance>(conn)
            .await?
    };

    Ok(instances)
}

/// ## Summary
/// Applies an addressbook filter to find matching instances.
///
/// Evaluates property filters with anyof/allof logic against `card_index`,
/// `card_email`, and `card_phone` tables.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn apply_addressbook_filter(
    conn: &mut DbConnection<'_>,
    base_query: dav_instance::BoxedQuery<'static, diesel::pg::Pg>,
    filter: &AddressbookFilter,
    limit: Option<u32>,
) -> anyhow::Result<Vec<DavInstance>> {
    // Collect matching entity IDs for each prop-filter
    let mut entity_id_sets: Vec<Vec<uuid::Uuid>> = Vec::new();

    for prop_filter in &filter.prop_filters {
        let entity_ids = evaluate_prop_filter(conn, prop_filter).await?;
        entity_id_sets.push(entity_ids);
    }

    // Combine results based on test mode (anyof/allof)
    let matching_entity_ids = match filter.test {
        FilterTest::AnyOf => {
            // Union: any filter matches
            let mut all_ids: Vec<uuid::Uuid> = entity_id_sets.into_iter().flatten().collect();
            all_ids.sort_unstable();
            all_ids.dedup();
            all_ids
        }
        FilterTest::AllOf => {
            // Intersection: all filters must match
            if entity_id_sets.is_empty() {
                Vec::new()
            } else {
                let mut result = entity_id_sets[0].clone();
                for id_set in &entity_id_sets[1..] {
                    result.retain(|id| id_set.contains(id));
                }
                result
            }
        }
    };

    // Query instances by entity IDs
    let mut final_query = base_query.filter(dav_instance::entity_id.eq_any(matching_entity_ids));

    if let Some(limit) = limit {
        final_query = final_query.limit(i64::from(limit));
    }

    let instances = final_query
        .select(DavInstance::as_select())
        .load::<DavInstance>(conn)
        .await?;

    Ok(instances)
}

/// ## Summary
/// Evaluates a single property filter and returns matching entity IDs.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_prop_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let prop_name = prop_filter.name.to_uppercase();

    // Handle specific properties with dedicated index tables
    match prop_name.as_str() {
        "EMAIL" => evaluate_email_filter(conn, prop_filter).await,
        "TEL" => evaluate_phone_filter(conn, prop_filter).await,
        "FN" | "N" | "ORG" | "TITLE" => evaluate_card_index_filter(conn, prop_filter).await,
        "UID" => evaluate_uid_filter(conn, prop_filter).await,
        _ => {
            // Unsupported property - return empty set
            // TODO: For full compliance, we should parse vCard data
            tracing::warn!("Property filter '{}' not yet supported", prop_name);
            Ok(Vec::new())
        }
    }
}

/// ## Summary
/// Evaluates email property filter against `card_email` table.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_email_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let mut query = card_email::table
        .filter(card_email::deleted_at.is_null())
        .into_boxed();

    if let Some(text_match) = &prop_filter.text_match {
        query = apply_text_match_email(query, text_match);
    }

    let entity_ids = query
        .select(card_email::entity_id)
        .distinct()
        .load::<uuid::Uuid>(conn)
        .await?;

    Ok(entity_ids)
}

/// ## Summary
/// Evaluates phone property filter against `card_phone` table.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_phone_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let mut query = card_phone::table
        .filter(card_phone::deleted_at.is_null())
        .into_boxed();

    if let Some(text_match) = &prop_filter.text_match {
        query = apply_text_match_phone(query, text_match);
    }

    let entity_ids = query
        .select(card_phone::entity_id)
        .distinct()
        .load::<uuid::Uuid>(conn)
        .await?;

    Ok(entity_ids)
}

/// ## Summary
/// ## Summary
/// Evaluates card index filter (`FN`, `N`, `ORG`, `TITLE`).
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_card_index_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let mut query = card_index::table
        .filter(card_index::deleted_at.is_null())
        .into_boxed();

    if let Some(text_match) = &prop_filter.text_match {
        query = apply_text_match_card_index(query, text_match, &prop_filter.name);
    }

    let entity_ids = query
        .select(card_index::entity_id)
        .distinct()
        .load::<uuid::Uuid>(conn)
        .await?;

    Ok(entity_ids)
}

/// ## Summary
/// Evaluates UID filter against `card_index`.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_uid_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let mut query = card_index::table
        .filter(card_index::deleted_at.is_null())
        .into_boxed();

    if let Some(text_match) = &prop_filter.text_match {
        query = apply_text_match_uid(query, text_match);
    }

    let entity_ids = query
        .select(card_index::entity_id)
        .distinct()
        .load::<uuid::Uuid>(conn)
        .await?;

    Ok(entity_ids)
}

/// ## Summary
/// Applies text-match to email query.
fn apply_text_match_email(
    mut query: card_email::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
) -> card_email::BoxedQuery<'static, diesel::pg::Pg> {
    let value = normalize_text_for_collation(&text_match.value, text_match.collation.as_ref());

    query = match text_match.match_type {
        MatchType::Contains => query.filter(card_email::email.ilike(format!("%{value}%"))),
        MatchType::Equals => query.filter(card_email::email.ilike(value)),
        MatchType::StartsWith => query.filter(card_email::email.ilike(format!("{value}%"))),
        MatchType::EndsWith => query.filter(card_email::email.ilike(format!("%{value}"))),
    };

    query
}

/// ## Summary
/// Applies text-match to phone query.
fn apply_text_match_phone(
    mut query: card_phone::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
) -> card_phone::BoxedQuery<'static, diesel::pg::Pg> {
    let value = normalize_text_for_collation(&text_match.value, text_match.collation.as_ref());

    query = match text_match.match_type {
        MatchType::Contains => query.filter(card_phone::phone_raw.ilike(format!("%{value}%"))),
        MatchType::Equals => query.filter(card_phone::phone_raw.ilike(value)),
        MatchType::StartsWith => query.filter(card_phone::phone_raw.ilike(format!("{value}%"))),
        MatchType::EndsWith => query.filter(card_phone::phone_raw.ilike(format!("%{value}"))),
    };

    query
}

/// ## Summary
/// Applies text-match to `card_index` query for specific property.
fn apply_text_match_card_index(
    mut query: card_index::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
    prop_name: &str,
) -> card_index::BoxedQuery<'static, diesel::pg::Pg> {
    let value = normalize_text_for_collation(&text_match.value, text_match.collation.as_ref());
    let prop_name = prop_name.to_uppercase();

    // Select the appropriate column based on property name
    query = match prop_name.as_str() {
        "FN" => match text_match.match_type {
            MatchType::Contains => query.filter(card_index::fn_.ilike(format!("%{value}%"))),
            MatchType::Equals => query.filter(card_index::fn_.ilike(value.clone())),
            MatchType::StartsWith => query.filter(card_index::fn_.ilike(format!("{value}%"))),
            MatchType::EndsWith => query.filter(card_index::fn_.ilike(format!("%{value}"))),
        },
        "ORG" => match text_match.match_type {
            MatchType::Contains => query.filter(card_index::org.ilike(format!("%{value}%"))),
            MatchType::Equals => query.filter(card_index::org.ilike(value.clone())),
            MatchType::StartsWith => query.filter(card_index::org.ilike(format!("{value}%"))),
            MatchType::EndsWith => query.filter(card_index::org.ilike(format!("%{value}"))),
        },
        "TITLE" => match text_match.match_type {
            MatchType::Contains => query.filter(card_index::title.ilike(format!("%{value}%"))),
            MatchType::Equals => query.filter(card_index::title.ilike(value.clone())),
            MatchType::StartsWith => query.filter(card_index::title.ilike(format!("{value}%"))),
            MatchType::EndsWith => query.filter(card_index::title.ilike(format!("%{value}"))),
        },
        _ => query, // Unknown property
    };

    query
}

/// ## Summary
/// Applies text-match to UID column.
fn apply_text_match_uid(
    mut query: card_index::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
) -> card_index::BoxedQuery<'static, diesel::pg::Pg> {
    let value = normalize_text_for_collation(&text_match.value, text_match.collation.as_ref());

    query = match text_match.match_type {
        MatchType::Contains => query.filter(card_index::uid.ilike(format!("%{value}%"))),
        MatchType::Equals => query.filter(card_index::uid.ilike(value)),
        MatchType::StartsWith => query.filter(card_index::uid.ilike(format!("{value}%"))),
        MatchType::EndsWith => query.filter(card_index::uid.ilike(format!("%{value}"))),
    };

    query
}

/// ## Summary
/// Normalizes text based on collation using ICU case folding.
///
/// For `i;unicode-casemap` collation, uses ICU's `fold_string()` for proper
/// Unicode case folding per RFC 4790. For `i;ascii-casemap`, uses simple
/// lowercasing. For `i;octet` or unknown collations, returns text as-is.
///
/// Unicode case folding differs from simple lowercasing in important ways:
/// - German `ß` folds to `ss`
/// - Greek final sigma `ς` normalizes to `σ`
/// - Turkish dotted I is handled correctly
#[must_use]
fn normalize_text_for_collation(text: &str, collation: Option<&String>) -> String {
    match collation.map(std::string::String::as_str) {
        // Use ICU case folding for proper Unicode collation
        Some("i;unicode-casemap") | None => CaseMapper::new().fold_string(text).into_owned(),
        // Simple ASCII lowercasing for ASCII-only comparison
        Some("i;ascii-casemap") => text.to_lowercase(),
        // Case-sensitive: return as-is
        _ => text.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_text_unicode_casemap_basic() {
        // Basic ASCII case folding
        let result = normalize_text_for_collation("Hello World", None);
        assert_eq!(result, "hello world");

        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_text_for_collation("Hello World", collation.as_ref());
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_normalize_text_unicode_casemap_german_eszett() {
        // German ß should fold to ss (ICU case folding)
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_text_for_collation("Straße", collation.as_ref());
        assert_eq!(result, "strasse");

        // Verify ß comparison: "STRASSE" and "Straße" should match after folding
        let upper = normalize_text_for_collation("STRASSE", collation.as_ref());
        assert_eq!(result, upper);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_greek_sigma() {
        // Greek final sigma ς and regular sigma σ should fold to the same value
        let collation = Some("i;unicode-casemap".to_string());
        let final_sigma = normalize_text_for_collation("Σ", collation.as_ref());
        let regular_sigma = normalize_text_for_collation("σ", collation.as_ref());
        assert_eq!(final_sigma, regular_sigma);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_international() {
        let collation = Some("i;unicode-casemap".to_string());

        // Cyrillic
        let result = normalize_text_for_collation("ПРИВЕТ", collation.as_ref());
        assert_eq!(result, "привет");

        // Greek
        let result = normalize_text_for_collation("ΓΕΙΆ", collation.as_ref());
        assert_eq!(result, "γειά");
    }

    #[test]
    fn test_normalize_text_ascii_casemap() {
        let collation = Some("i;ascii-casemap".to_string());

        // ASCII lowercasing
        let result = normalize_text_for_collation("Hello World", collation.as_ref());
        assert_eq!(result, "hello world");

        // Note: ASCII casemap uses simple to_lowercase, which doesn't fold ß
        let result = normalize_text_for_collation("Straße", collation.as_ref());
        assert_eq!(result, "straße"); // NOT "strasse"
    }

    #[test]
    fn test_normalize_text_octet_case_sensitive() {
        let collation = Some("i;octet".to_string());

        // i;octet should preserve case exactly
        let result = normalize_text_for_collation("Hello World", collation.as_ref());
        assert_eq!(result, "Hello World");

        let result = normalize_text_for_collation("Straße", collation.as_ref());
        assert_eq!(result, "Straße");
    }
}
