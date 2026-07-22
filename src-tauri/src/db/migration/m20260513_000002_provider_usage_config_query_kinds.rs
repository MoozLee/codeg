use sea_orm::{ConnectionTrait, DbBackend, Statement};
use sea_orm_migration::prelude::*;

/// Rename `provider_usage_config.query_kind` to `query_kinds` and convert
/// the previously stored single snake_case value into a JSON array of one
/// element. Run after the original `m20260513_000001` migration shipped to
/// dev databases with the single-kind column.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();

        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "ALTER TABLE provider_usage_config RENAME COLUMN query_kind TO query_kinds".to_owned(),
        ))
        .await?;

        // Wrap existing single-value rows into a JSON array, but skip any row
        // that has already been migrated (idempotent on re-run).
        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE provider_usage_config \
             SET query_kinds = json_array(query_kinds) \
             WHERE query_kinds NOT LIKE '[%'"
                .to_owned(),
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();

        // Best-effort: unwrap the first element back to a single value, then
        // rename the column back.
        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE provider_usage_config \
             SET query_kinds = COALESCE(json_extract(query_kinds, '$[0]'), query_kinds) \
             WHERE query_kinds LIKE '[%'"
                .to_owned(),
        ))
        .await?;

        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "ALTER TABLE provider_usage_config RENAME COLUMN query_kinds TO query_kind".to_owned(),
        ))
        .await?;

        Ok(())
    }
}
