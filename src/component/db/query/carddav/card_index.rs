//! Query composition for `card_index`, `card_email`, `card_phone`.

use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use uuid::Uuid;

use crate::component::db::connection::DbConnection;
use crate::component::db::schema::card_index;
use crate::component::model::carddav::card_index::NewCardIndex;

/// ## Summary
/// Inserts a card index entry.
///
/// ## Errors
/// Returns an error if the database operation fails.
pub async fn insert<'a>(conn: &mut DbConnection<'_>, index: &NewCardIndex<'a>) -> QueryResult<()> {
    diesel::insert_into(card_index::table)
        .values(index)
        .execute(conn)
        .await?;
    Ok(())
}

/// ## Summary
/// Deletes the card index entry for an entity.
///
/// ## Errors
/// Returns an error if the database operation fails.
pub async fn delete_by_entity_id(conn: &mut DbConnection<'_>, entity_id: Uuid) -> QueryResult<()> {
    diesel::delete(card_index::table.filter(card_index::entity_id.eq(entity_id)))
        .execute(conn)
        .await?;
    Ok(())
}
