//! `CardDAV` filter evaluation for addressbook-query reports.
//!
//! Implements filter logic for property-filter and text-match
//! matching against vCard data.

use crate::db::connection::DbConnection;
use crate::db::query::text_match::{
    Casemap, CollationError, build_like_pattern, normalize_for_folded_compare,
};
use crate::db::schema::{card_index, dav_component, dav_instance, dav_parameter, dav_property};
use crate::model::dav::instance::DavInstance;
use diesel::prelude::*;
use diesel::sql_types;
use diesel_async::RunQueryDsl;
use shuriken_core::error::CoreError;
use shuriken_rfc::rfc::dav::core::{
    AddressbookFilter, AddressbookQuery, FilterTest, MatchType, ParamFilter, PropFilter, TextMatch,
};

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
    tracing::debug!(collection_id = %collection_id, has_filter = query.filter.is_some(), "Finding matching addressbook instances");

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
    tracing::trace!(prop_filter_count = filter.prop_filters.len(), test = ?filter.test, "Applying addressbook filter");

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
    tracing::trace!(prop_name = %prop_name, is_not_defined = prop_filter.is_not_defined, has_text_match = prop_filter.text_match.is_some(), "Evaluating property filter");

    // Handle specific properties with dedicated index tables for performance
    let entity_ids = match prop_name.as_str() {
        "EMAIL" => evaluate_email_filter(conn, prop_filter).await?,
        "TEL" => evaluate_phone_filter(conn, prop_filter).await?,
        "FN" | "N" | "ORG" | "TITLE" => evaluate_card_index_filter(conn, prop_filter).await?,
        "UID" => evaluate_uid_filter(conn, prop_filter).await?,
        // All other properties: query dav_property table
        _ => evaluate_arbitrary_property_filter(conn, prop_filter).await?,
    };

    // Apply param-filters if present
    if prop_filter.param_filters.is_empty() {
        Ok(entity_ids)
    } else {
        apply_param_filters(
            conn,
            &entity_ids,
            &prop_name,
            &prop_filter.param_filters,
            prop_filter.test,
        )
        .await
    }
}

/// ## Summary
/// Evaluates arbitrary `vCard` property filter against `dav_property` table.
///
/// Supports any `vCard` property including ADR, NOTE, BDAY, PHOTO, etc.
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
    tracing::trace!(prop_name = %prop_name, collation = ?text_match.collation, match_type = ?text_match.match_type, negate = text_match.negate, "Applying text-match to property");

    let collation = normalize_for_folded_compare(&text_match.value, text_match.collation.as_ref())?;
    let raw_value = collation.value;
    let raw_pattern = build_like_pattern(&raw_value, &text_match.match_type);
    let value = raw_value.replace('\'', "''");
    let pattern = raw_pattern.replace('\'', "''");
    let fold_column = match collation.casemap {
        Casemap::Octet => None,
        Casemap::Ascii => Some("value_text_ascii_fold"),
        Casemap::Unicode => Some("value_text_unicode_fold"),
    };

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
            MatchType::Equals => query.filter(dav_property::value_text.eq(&raw_value)),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                query.filter(dav_property::value_text.like(raw_pattern))
            }
        };
    } else if let Some(column) = fold_column {
        // Case-insensitive: use folded generated columns
        query = match text_match.match_type {
            MatchType::Equals => query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                &format!("{column} = '{value}'"),
            )),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => query.filter(
                diesel::dsl::sql::<diesel::sql_types::Bool>(&format!("{column} LIKE '{pattern}'")),
            ),
        };
    } else {
        // No folding needed
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
/// Evaluates email property filter against `card_index.data` JSONB field.
///
/// Queries the emails array in the JSONB data field.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_email_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    use diesel::sql_types::{Text, Uuid as SqlUuid};

    #[derive(QueryableByName)]
    struct EntityId {
        #[diesel(sql_type = SqlUuid)]
        entity_id: uuid::Uuid,
    }

    if prop_filter.is_not_defined {
        // EMAIL must NOT exist - find cards where emails array is empty or null
        let query = diesel::sql_query(
            "SELECT entity_id FROM card_index \
             WHERE deleted_at IS NULL \
             AND (data->'emails' IS NULL OR jsonb_array_length(data->'emails') = 0)",
        );

        let results: Vec<EntityId> = query.load(conn).await?;
        return Ok(results.into_iter().map(|r| r.entity_id).collect());
    }

    if let Some(text_match) = &prop_filter.text_match {
        let collation =
            normalize_for_folded_compare(&text_match.value, text_match.collation.as_ref())?;
        let value = collation.value;
        let pattern = build_like_pattern(&value, &text_match.match_type);
        let (column_prefix, use_fold) = match collation.casemap {
            Casemap::Octet => ("data", false),
            Casemap::Ascii => ("data_ascii_fold", true),
            Casemap::Unicode => ("data_unicode_fold", true),
        };

        // Query entities where any email in the array matches
        let query_str = if use_fold {
            format!(
                "SELECT DISTINCT entity_id FROM card_index, \
                 jsonb_array_elements_text({column_prefix}->'emails') AS email \
                 WHERE deleted_at IS NULL AND email LIKE $1"
            )
        } else {
            "SELECT DISTINCT entity_id FROM card_index, \
             jsonb_array_elements_text(data->'emails') AS email \
             WHERE deleted_at IS NULL AND email LIKE $1"
                .to_string()
        };

        let query = diesel::sql_query(query_str).bind::<Text, _>(
            if text_match.match_type == MatchType::Equals {
                &value
            } else {
                &pattern
            },
        );

        let matched_ids: Vec<EntityId> = query.load(conn).await?;
        let matched: Vec<uuid::Uuid> = matched_ids.into_iter().map(|r| r.entity_id).collect();

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
                .filter(|id| !matched.contains(id))
                .collect());
        }

        return Ok(matched);
    }

    // No text-match, just return all entities that have at least one email
    let query = diesel::sql_query(
        "SELECT entity_id FROM card_index \
         WHERE deleted_at IS NULL \
         AND data->'emails' IS NOT NULL \
         AND jsonb_array_length(data->'emails') > 0",
    );

    let results: Vec<EntityId> = query.load(conn).await?;
    Ok(results.into_iter().map(|r| r.entity_id).collect())
}

/// ## Summary
/// Evaluates phone property filter against `card_index.data` JSONB field.
///
/// Queries the phones array in the JSONB data field.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn evaluate_phone_filter(
    conn: &mut DbConnection<'_>,
    prop_filter: &PropFilter,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    use diesel::sql_types::{Text, Uuid as SqlUuid};

    #[derive(QueryableByName)]
    struct EntityId {
        #[diesel(sql_type = SqlUuid)]
        entity_id: uuid::Uuid,
    }

    if prop_filter.is_not_defined {
        // TEL must NOT exist - find cards where phones array is empty or null
        let query = diesel::sql_query(
            "SELECT entity_id FROM card_index \
             WHERE deleted_at IS NULL \
             AND (data->'phones' IS NULL OR jsonb_array_length(data->'phones') = 0)",
        );

        let results: Vec<EntityId> = query.load(conn).await?;
        return Ok(results.into_iter().map(|r| r.entity_id).collect());
    }

    if let Some(text_match) = &prop_filter.text_match {
        let collation =
            normalize_for_folded_compare(&text_match.value, text_match.collation.as_ref())?;
        let value = collation.value;
        let pattern = build_like_pattern(&value, &text_match.match_type);
        let (column_prefix, use_fold) = match collation.casemap {
            Casemap::Octet => ("data", false),
            Casemap::Ascii => ("data_ascii_fold", true),
            Casemap::Unicode => ("data_unicode_fold", true),
        };

        // Query entities where any phone in the array matches
        let query_str = if use_fold {
            format!(
                "SELECT DISTINCT entity_id FROM card_index, \
                 jsonb_array_elements_text({column_prefix}->'phones') AS phone \
                 WHERE deleted_at IS NULL AND phone LIKE $1"
            )
        } else {
            "SELECT DISTINCT entity_id FROM card_index, \
             jsonb_array_elements_text(data->'phones') AS phone \
             WHERE deleted_at IS NULL AND phone LIKE $1"
                .to_string()
        };

        let query = diesel::sql_query(query_str).bind::<Text, _>(
            if text_match.match_type == MatchType::Equals {
                &value
            } else {
                &pattern
            },
        );

        let matched_ids: Vec<EntityId> = query.load(conn).await?;
        let matched: Vec<uuid::Uuid> = matched_ids.into_iter().map(|r| r.entity_id).collect();

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
                .filter(|id| !matched.contains(id))
                .collect());
        }

        return Ok(matched);
    }

    // No text-match, just return all entities that have at least one phone
    let query = diesel::sql_query(
        "SELECT entity_id FROM card_index \
         WHERE deleted_at IS NULL \
         AND data->'phones' IS NOT NULL \
         AND jsonb_array_length(data->'phones') > 0",
    );

    let results: Vec<EntityId> = query.load(conn).await?;
    Ok(results.into_iter().map(|r| r.entity_id).collect())
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
        query = apply_text_match_card_index(query, text_match, &prop_name)?;

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
/// Applies param-filters to further filter entity IDs.
///
/// Filters entities to only those that have properties matching the given
/// property name where the property has parameters matching the param-filters.
/// Uses `test` to determine if param-filters are AND-combined (`allof`) or OR-combined (`anyof`).
///
/// ## Errors
/// Returns database errors if queries fail.
async fn apply_param_filters(
    conn: &mut DbConnection<'_>,
    entity_ids: &[uuid::Uuid],
    prop_name: &str,
    param_filters: &[ParamFilter],
    test: FilterTest,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    if entity_ids.is_empty() || param_filters.is_empty() {
        return Ok(entity_ids.to_vec());
    }

    // Get all property IDs for the given property name and entities
    let prop_ids: Vec<(uuid::Uuid, uuid::Uuid)> = dav_component::table
        .inner_join(dav_property::table.on(dav_property::component_id.eq(dav_component::id)))
        .filter(dav_component::entity_id.eq_any(entity_ids))
        .filter(dav_component::name.eq("VCARD"))
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
async fn evaluate_single_param_filter(
    conn: &mut DbConnection<'_>,
    prop_ids: &[uuid::Uuid],
    param_name: &str,
    param_filter: &ParamFilter,
) -> anyhow::Result<std::collections::HashSet<uuid::Uuid>> {
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
        evaluate_single_param_filter_with_text_match(conn, prop_ids, param_name, text_match).await
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

async fn evaluate_single_param_filter_with_text_match(
    conn: &mut DbConnection<'_>,
    prop_ids: &[uuid::Uuid],
    param_name: &str,
    text_match: &TextMatch,
) -> Result<std::collections::HashSet<uuid::Uuid>, anyhow::Error> {
    // Parameter must exist and match text
    let collation = normalize_for_folded_compare(&text_match.value, text_match.collation.as_ref())?;
    let raw_value = collation.value;
    let raw_pattern = build_like_pattern(&raw_value, &text_match.match_type);
    let value = raw_value.replace('\'', "''");
    let pattern = raw_pattern.replace('\'', "''");

    let mut query = dav_parameter::table
        .filter(dav_parameter::property_id.eq_any(prop_ids))
        .filter(dav_parameter::name.eq(param_name))
        .filter(dav_parameter::deleted_at.is_null())
        .into_boxed();

    // Apply text matching
    if collation.case_sensitive {
        query = match text_match.match_type {
            MatchType::Equals => query.filter(dav_parameter::value.eq(&raw_value)),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                query.filter(dav_parameter::value.like(&raw_pattern))
            }
        };
    } else {
        let func = match collation.casemap {
            Casemap::Ascii => "ascii_casemap",
            Casemap::Unicode => "unicode_casemap_nfc",
            Casemap::Octet => {
                return Err(CoreError::InvariantViolation(
                    "Octet collation should be handled as case-sensitive",
                )
                .into());
            }
        };
        query = match text_match.match_type {
            MatchType::Equals => query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                &format!("{func}(value) = '{value}'"),
            )),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
                    "{func}(value) LIKE '{pattern}'"
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
}

/// ## Summary
/// Applies text-match to `card_index` query for specific property using
/// casemap-folded columns.
fn apply_text_match_card_index(
    query: card_index::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
    prop_name: &str,
) -> Result<card_index::BoxedQuery<'static, diesel::pg::Pg>, CollationError> {
    use diesel::dsl::sql;
    use diesel::sql_types::Bool;

    let collation = normalize_for_folded_compare(&text_match.value, text_match.collation.as_ref())?;
    let value = collation.value.replace('\'', "''");
    let pattern = build_like_pattern(&collation.value, &text_match.match_type).replace('\'', "''");
    let (fn_column, data_column) = match collation.casemap {
        Casemap::Octet => ("fn", "data"),
        Casemap::Ascii => ("fn_ascii_fold", "data_ascii_fold"),
        Casemap::Unicode => ("fn_unicode_fold", "data_unicode_fold"),
    };

    // Select the appropriate column or JSONB field based on property name
    Ok(match prop_name {
        "FN" => match text_match.match_type {
            MatchType::Equals => query.filter(sql::<Bool>(&format!("{fn_column} = '{value}'"))),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
                query.filter(sql::<Bool>(&format!("{fn_column} LIKE '{pattern}'")))
            }
        },
        "ORG" => match text_match.match_type {
            MatchType::Equals => {
                query.filter(sql::<Bool>(&format!("({data_column}->>'org') = '{value}'")))
            }
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => query.filter(
                sql::<Bool>(&format!("({data_column}->>'org') LIKE '{pattern}'")),
            ),
        },
        "TITLE" => match text_match.match_type {
            MatchType::Equals => query.filter(sql::<Bool>(&format!(
                "({data_column}->>'title') = '{value}'"
            ))),
            MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => query.filter(
                sql::<Bool>(&format!("({data_column}->>'title') LIKE '{pattern}'")),
            ),
        },
        _ => query, // N is handled via card_index but doesn't have a dedicated column
    })
}

/// CardDAV index query result type.
type CardIndexQueryResult = diesel::query_builder::BoxedSelectStatement<
    'static,
    (
        sql_types::Uuid,
        sql_types::Nullable<sql_types::Text>,
        sql_types::Nullable<sql_types::Text>,
        sql_types::Timestamptz,
        sql_types::Nullable<sql_types::Timestamptz>,
        sql_types::Nullable<sql_types::Jsonb>,
        sql_types::Nullable<crate::db::schema::sql_types::Tsvector>,
        sql_types::Nullable<sql_types::Text>,
        sql_types::Nullable<sql_types::Text>,
        sql_types::Nullable<sql_types::Jsonb>,
        sql_types::Nullable<sql_types::Jsonb>,
    ),
    diesel::query_builder::FromClause<crate::db::schema::card_index::table>,
    diesel::pg::Pg,
>;

/// ## Summary
/// Applies text-match to UID column using case-sensitive comparisons.
fn apply_text_match_uid(
    query: card_index::BoxedQuery<'static, diesel::pg::Pg>,
    text_match: &TextMatch,
) -> CardIndexQueryResult {
    let value = text_match.value.clone();
    let pattern = build_like_pattern(&value, &text_match.match_type);

    match text_match.match_type {
        MatchType::Equals => query.filter(card_index::uid.eq(value)),
        MatchType::Contains | MatchType::StartsWith | MatchType::EndsWith => {
            query.filter(card_index::uid.like(pattern))
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::db::query::text_match::{normalize_for_ilike, normalize_for_sql_upper};

    #[test]
    fn test_normalize_text_unicode_casemap_basic() {
        // Basic ASCII case folding
        let result = normalize_for_ilike("Hello World", None).unwrap();
        assert_eq!(result, "hello world");

        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_ilike("Hello World", collation.as_ref()).unwrap();
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_normalize_text_unicode_casemap_german_eszett() {
        // German ß should fold to ss (ICU case folding)
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_ilike("Straße", collation.as_ref()).unwrap();
        assert_eq!(result, "strasse");

        // Verify ß comparison: "STRASSE" and "Straße" should match after folding
        let upper = normalize_for_ilike("STRASSE", collation.as_ref()).unwrap();
        assert_eq!(result, upper);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_greek_sigma() {
        // Greek final sigma ς and regular sigma σ should fold to the same value
        let collation = Some("i;unicode-casemap".to_string());
        let final_sigma = normalize_for_ilike("Σ", collation.as_ref()).unwrap();
        let regular_sigma = normalize_for_ilike("σ", collation.as_ref()).unwrap();
        assert_eq!(final_sigma, regular_sigma);
    }

    #[test]
    fn test_normalize_text_unicode_casemap_international() {
        let collation = Some("i;unicode-casemap".to_string());

        // Cyrillic
        let result = normalize_for_ilike("ПРИВЕТ", collation.as_ref()).unwrap();
        assert_eq!(result, "привет");

        // Greek
        let result = normalize_for_ilike("ΓΕΙΆ", collation.as_ref()).unwrap();
        assert_eq!(result, "γειά");
    }

    #[test]
    fn test_normalize_text_ascii_casemap() {
        let collation = Some("i;ascii-casemap".to_string());

        // ASCII lowercasing
        let result = normalize_for_ilike("Hello World", collation.as_ref()).unwrap();
        assert_eq!(result, "hello world");

        // RFC 4790 §9.2.1: ASCII casemap only converts ASCII letters (a-z),
        // non-ASCII characters like ß are left unchanged
        let result = normalize_for_ilike("Straße", collation.as_ref()).unwrap();
        assert_eq!(result, "straße"); // ß is unchanged, not folded to ss

        // Verify uppercase: ASCII letters converted, non-ASCII unchanged
        let result = normalize_for_sql_upper("Straße", collation.as_ref()).unwrap();
        assert_eq!(result.value, "STRAßE"); // ß stays as ß, not STRASSE
    }

    #[test]
    fn test_normalize_text_octet_case_sensitive() {
        let collation = Some("i;octet".to_string());

        // i;octet should preserve case exactly
        let result = normalize_for_ilike("Hello World", collation.as_ref()).unwrap();
        assert_eq!(result, "Hello World");

        let result = normalize_for_ilike("Straße", collation.as_ref()).unwrap();
        assert_eq!(result, "Straße");
    }

    #[test]
    fn test_normalize_for_sql_upper() {
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_sql_upper("Straße", collation.as_ref()).unwrap();
        assert_eq!(result.value, "STRASSE");
        assert!(!result.case_sensitive);
    }
}
