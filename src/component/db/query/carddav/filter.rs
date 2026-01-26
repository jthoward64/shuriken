//! `CardDAV` filter evaluation for addressbook-query reports.
//!
//! Implements filter logic for property-filter and text-match
//! matching against vCard data.

use crate::component::db::connection::DbConnection;
use crate::component::db::query::text_match::{
    build_like_pattern, normalize_for_ilike, normalize_for_sql_upper,
};
use crate::component::db::schema::{
    card_email, card_index, card_phone, dav_component, dav_instance, dav_property,
};
use crate::component::model::dav::instance::DavInstance;
use crate::component::rfc::dav::core::{
    AddressbookFilter, AddressbookQuery, FilterTest, MatchType, PropFilter, TextMatch,
};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;

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
/// `card_email`, and `card_phone` tables. Falls back to `dav_property` for
/// non-indexed properties.
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
/// Uses indexed tables for common properties (EMAIL, TEL, FN, etc.) and falls
/// back to `dav_property` table for arbitrary vCard properties.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_prop_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let prop_name = prop_filter.name.to_uppercase();

    // Handle specific properties with dedicated index tables for performance
    match prop_name.as_str() {
        "EMAIL" => evaluate_email_filter(conn, prop_filter).await,
        "TEL" => evaluate_phone_filter(conn, prop_filter).await,
        "FN" | "N" | "ORG" | "TITLE" => evaluate_card_index_filter(conn, prop_filter).await,
        "UID" => evaluate_uid_filter(conn, prop_filter).await,
        // All other properties: query dav_property table
        _ => evaluate_arbitrary_property_filter(conn, prop_filter).await,
    }
}

/// ## Summary
/// Evaluates arbitrary vCard property filter against `dav_property` table.
///
/// Supports any vCard property including ADR, NOTE, BDAY, PHOTO, etc.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_arbitrary_property_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let prop_name = prop_filter.name.to_uppercase();

    if prop_filter.is_not_defined {
        // Property must NOT exist - find vCard entities without this property
        let entities_with_prop: Vec<uuid::Uuid> = dav_component::table
            .inner_join(dav_property::table.on(dav_property::component_id.eq(dav_component::id)))
            .filter(dav_component::name.eq("VCARD"))
            .filter(dav_property::name.eq(&prop_name))
            .filter(dav_property::deleted_at.is_null())
            .filter(dav_component::deleted_at.is_null())
            .select(dav_component::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        // Get all vCard entity IDs, then exclude those with the property
        let all_vcard_ids: Vec<uuid::Uuid> = dav_component::table
            .filter(dav_component::name.eq("VCARD"))
            .filter(dav_component::deleted_at.is_null())
            .select(dav_component::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        return Ok(all_vcard_ids
            .into_iter()
            .filter(|id| !entities_with_prop.contains(id))
            .collect());
    }

    if let Some(text_match) = &prop_filter.text_match {
        // Property must exist and match text
        let matched_ids = apply_text_match_to_property(conn, &prop_name, text_match).await?;

        // Handle negate attribute: if true, return entities that DON'T match
        if text_match.negate {
            let all_vcard_ids: Vec<uuid::Uuid> = dav_component::table
                .filter(dav_component::name.eq("VCARD"))
                .filter(dav_component::deleted_at.is_null())
                .select(dav_component::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?;

            Ok(all_vcard_ids
                .into_iter()
                .filter(|id| !matched_ids.contains(id))
                .collect())
        } else {
            Ok(matched_ids)
        }
    } else {
        // Property must exist (no text match specified)
        let entity_ids = dav_component::table
            .inner_join(dav_property::table.on(dav_property::component_id.eq(dav_component::id)))
            .filter(dav_component::name.eq("VCARD"))
            .filter(dav_property::name.eq(&prop_name))
            .filter(dav_property::deleted_at.is_null())
            .filter(dav_component::deleted_at.is_null())
            .select(dav_component::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        Ok(entity_ids)
    }
}

/// ## Summary
/// Applies text-match to `dav_property` table for arbitrary property.
async fn apply_text_match_to_property(
    conn: &mut DbConnection<'_>,
    prop_name: &str,
    text_match: &TextMatch,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let collation = normalize_for_sql_upper(&text_match.value, text_match.collation.as_ref());
    let pattern = build_like_pattern(&collation.value, &text_match.match_type);

    let mut query = dav_component::table
        .inner_join(dav_property::table.on(dav_property::component_id.eq(dav_component::id)))
        .filter(dav_component::name.eq("VCARD"))
        .filter(dav_property::name.eq(prop_name))
        .filter(dav_property::deleted_at.is_null())
        .filter(dav_component::deleted_at.is_null())
        .into_boxed();

    // Apply text matching based on collation and match type
    if collation.case_sensitive {
        // i;octet - case-sensitive comparison
        query = match text_match.match_type {
            MatchType::Equals => query.filter(dav_property::value_text.eq(&collation.value)),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => query.filter(
                dav_property::value_text
                    .like(build_like_pattern(&collation.value, &text_match.match_type)),
            ),
        };
    } else {
        // Case-insensitive: use SQL UPPER() with the pre-uppercased pattern
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

    // Handle negate attribute
    let entity_ids = query
        .select(dav_component::entity_id)
        .distinct()
        .load::<uuid::Uuid>(conn)
        .await?;

    Ok(entity_ids)
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
    if prop_filter.is_not_defined {
        // EMAIL must NOT exist - get all entities and exclude those with emails
        let entities_with_email: Vec<uuid::Uuid> = card_email::table
            .filter(card_email::deleted_at.is_null())
            .select(card_email::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        let all_card_ids: Vec<uuid::Uuid> = card_index::table
            .filter(card_index::deleted_at.is_null())
            .select(card_index::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        return Ok(all_card_ids
            .into_iter()
            .filter(|id| !entities_with_email.contains(id))
            .collect());
    }

    let mut query = card_email::table
        .filter(card_email::deleted_at.is_null())
        .into_boxed();

    if let Some(text_match) = &prop_filter.text_match {
        query = apply_text_match_email(query, text_match);

        let matched_ids = query
            .select(card_email::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        // Handle negate attribute
        if text_match.negate {
            let all_card_ids: Vec<uuid::Uuid> = card_index::table
                .filter(card_index::deleted_at.is_null())
                .select(card_index::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?;

            return Ok(all_card_ids
                .into_iter()
                .filter(|id| !matched_ids.contains(id))
                .collect());
        }

        return Ok(matched_ids);
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
    if prop_filter.is_not_defined {
        // TEL must NOT exist - get all entities and exclude those with phones
        let entities_with_phone: Vec<uuid::Uuid> = card_phone::table
            .filter(card_phone::deleted_at.is_null())
            .select(card_phone::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        let all_card_ids: Vec<uuid::Uuid> = card_index::table
            .filter(card_index::deleted_at.is_null())
            .select(card_index::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        return Ok(all_card_ids
            .into_iter()
            .filter(|id| !entities_with_phone.contains(id))
            .collect());
    }

    let mut query = card_phone::table
        .filter(card_phone::deleted_at.is_null())
        .into_boxed();

    if let Some(text_match) = &prop_filter.text_match {
        query = apply_text_match_phone(query, text_match);

        let matched_ids = query
            .select(card_phone::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        // Handle negate attribute
        if text_match.negate {
            let all_card_ids: Vec<uuid::Uuid> = card_index::table
                .filter(card_index::deleted_at.is_null())
                .select(card_index::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?;

            return Ok(all_card_ids
                .into_iter()
                .filter(|id| !matched_ids.contains(id))
                .collect());
        }

        return Ok(matched_ids);
    }

    let entity_ids = query
        .select(card_phone::entity_id)
        .distinct()
        .load::<uuid::Uuid>(conn)
        .await?;

    Ok(entity_ids)
}

/// ## Summary
/// Evaluates card index filter (`FN`, `N`, `ORG`, `TITLE`).
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_card_index_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let prop_name = prop_filter.name.to_uppercase();

    if prop_filter.is_not_defined {
        // Property must NOT exist - need to check dav_property table for this
        return evaluate_arbitrary_property_filter(conn, prop_filter).await;
    }

    let mut query = card_index::table
        .filter(card_index::deleted_at.is_null())
        .into_boxed();

    if let Some(text_match) = &prop_filter.text_match {
        query = apply_text_match_card_index(query, text_match, &prop_name);

        let matched_ids = query
            .select(card_index::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        // Handle negate: return entities that DON'T match
        if text_match.negate {
            let matched_set: std::collections::HashSet<_> = matched_ids.into_iter().collect();
            let all_card_ids = card_index::table
                .filter(card_index::deleted_at.is_null())
                .select(card_index::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?;
            return Ok(all_card_ids
                .into_iter()
                .filter(|id| !matched_set.contains(id))
                .collect());
        }

        return Ok(matched_ids);
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
    if prop_filter.is_not_defined {
        // UID must NOT exist - unusual but supported
        return evaluate_arbitrary_property_filter(conn, prop_filter).await;
    }

    let mut query = card_index::table
        .filter(card_index::deleted_at.is_null())
        .into_boxed();

    if let Some(text_match) = &prop_filter.text_match {
        query = apply_text_match_uid(query, text_match);

        let matched_ids = query
            .select(card_index::entity_id)
            .distinct()
            .load::<uuid::Uuid>(conn)
            .await?;

        // Handle negate: return entities that DON'T match
        if text_match.negate {
            let matched_set: std::collections::HashSet<_> = matched_ids.into_iter().collect();
            let all_card_ids = card_index::table
                .filter(card_index::deleted_at.is_null())
                .select(card_index::entity_id)
                .distinct()
                .load::<uuid::Uuid>(conn)
                .await?;
            return Ok(all_card_ids
                .into_iter()
                .filter(|id| !matched_set.contains(id))
                .collect());
        }

        return Ok(matched_ids);
    }

    let entity_ids = query
        .select(card_index::entity_id)
        .distinct()
        .load::<uuid::Uuid>(conn)
        .await?;

    Ok(entity_ids)
}

/// ## Summary
/// Applies text-match to email query using ILIKE.
fn apply_text_match_email(
    query: card_email::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
) -> card_email::BoxedQuery<'static, diesel::pg::Pg> {
    let value = normalize_for_ilike(&text_match.value, text_match.collation.as_ref());
    let pattern = build_like_pattern(&value, &text_match.match_type);

    match text_match.match_type {
        MatchType::Equals => query.filter(card_email::email.ilike(value)),
        MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
            query.filter(card_email::email.ilike(pattern))
        }
    }
}

/// ## Summary
/// Applies text-match to phone query using ILIKE.
fn apply_text_match_phone(
    query: card_phone::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
) -> card_phone::BoxedQuery<'static, diesel::pg::Pg> {
    let value = normalize_for_ilike(&text_match.value, text_match.collation.as_ref());
    let pattern = build_like_pattern(&value, &text_match.match_type);

    match text_match.match_type {
        MatchType::Equals => query.filter(card_phone::phone_raw.ilike(value)),
        MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
            query.filter(card_phone::phone_raw.ilike(pattern))
        }
    }
}

/// ## Summary
/// Applies text-match to `card_index` query for specific property using ILIKE.
fn apply_text_match_card_index(
    query: card_index::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
    prop_name: &str,
) -> card_index::BoxedQuery<'static, diesel::pg::Pg> {
    let value = normalize_for_ilike(&text_match.value, text_match.collation.as_ref());
    let pattern = build_like_pattern(&value, &text_match.match_type);

    // Select the appropriate column based on property name
    match prop_name {
        "FN" => match text_match.match_type {
            MatchType::Equals => query.filter(card_index::fn_.ilike(value)),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                query.filter(card_index::fn_.ilike(pattern))
            }
        },
        "ORG" => match text_match.match_type {
            MatchType::Equals => query.filter(card_index::org.ilike(value)),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                query.filter(card_index::org.ilike(pattern))
            }
        },
        "TITLE" => match text_match.match_type {
            MatchType::Equals => query.filter(card_index::title.ilike(value)),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                query.filter(card_index::title.ilike(pattern))
            }
        },
        _ => query, // N is handled via card_index but doesn't have a dedicated column
    }
}

/// ## Summary
/// Applies text-match to UID column using ILIKE.
fn apply_text_match_uid(
    query: card_index::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
) -> card_index::BoxedQuery<'static, diesel::pg::Pg> {
    let value = normalize_for_ilike(&text_match.value, text_match.collation.as_ref());
    let pattern = build_like_pattern(&value, &text_match.match_type);

    match text_match.match_type {
        MatchType::Equals => query.filter(card_index::uid.ilike(value)),
        MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
            query.filter(card_index::uid.ilike(pattern))
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::component::db::query::text_match::{normalize_for_ilike, normalize_for_sql_upper};

    #[test]
    fn test_normalize_text_unicode_casemap_basic() {
        // Basic ASCII case folding
        let result = normalize_for_ilike("Hello World", None);
        assert_eq!(result, "hello world");

        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_ilike("Hello World", collation.as_ref());
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_normalize_text_unicode_casemap_german_eszett() {
        // German ß should fold to ss (ICU case folding)
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_ilike("Straße", collation.as_ref());
        assert_eq!(result, "strasse");

        // Verify ß comparison: "STRASSE" and "Straße" should match after folding
        let upper = normalize_for_ilike("STRASSE", collation.as_ref());
        assert_eq!(result, upper);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_greek_sigma() {
        // Greek final sigma ς and regular sigma σ should fold to the same value
        let collation = Some("i;unicode-casemap".to_string());
        let final_sigma = normalize_for_ilike("Σ", collation.as_ref());
        let regular_sigma = normalize_for_ilike("σ", collation.as_ref());
        assert_eq!(final_sigma, regular_sigma);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_international() {
        let collation = Some("i;unicode-casemap".to_string());

        // Cyrillic
        let result = normalize_for_ilike("ПРИВЕТ", collation.as_ref());
        assert_eq!(result, "привет");

        // Greek
        let result = normalize_for_ilike("ΓΕΙΆ", collation.as_ref());
        assert_eq!(result, "γειά");
    }

    #[test]
    fn test_normalize_text_ascii_casemap() {
        let collation = Some("i;ascii-casemap".to_string());

        // ASCII lowercasing
        let result = normalize_for_ilike("Hello World", collation.as_ref());
        assert_eq!(result, "hello world");

        // Note: ASCII casemap uses simple to_lowercase, which doesn't fold ß
        let result = normalize_for_ilike("Straße", collation.as_ref());
        assert_eq!(result, "straße"); // NOT "strasse"
    }

    #[test]
    fn test_normalize_text_octet_case_sensitive() {
        let collation = Some("i;octet".to_string());

        // i;octet should preserve case exactly
        let result = normalize_for_ilike("Hello World", collation.as_ref());
        assert_eq!(result, "Hello World");

        let result = normalize_for_ilike("Straße", collation.as_ref());
        assert_eq!(result, "Straße");
    }

    #[test]
    fn test_normalize_for_sql_upper() {
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_sql_upper("Straße", collation.as_ref());
        assert_eq!(result.value, "STRASSE");
        assert!(!result.case_sensitive);
    }
}
