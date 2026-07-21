use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ProviderUsageConfig::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ProviderUsageConfig::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::Name)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::QueryKind)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::BaseUrl)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::UserId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::ShowInStatusBar)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::RefreshIntervalMinutes)
                            .integer()
                            .not_null()
                            .default(5),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::TimeoutSeconds)
                            .integer()
                            .not_null()
                            .default(10),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::SortOrder)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ProviderUsageConfig::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_provider_usage_config_sort_order")
                    .table(ProviderUsageConfig::Table)
                    .col(ProviderUsageConfig::SortOrder)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ProviderUsageConfig::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ProviderUsageConfig {
    Table,
    Id,
    Name,
    QueryKind,
    BaseUrl,
    UserId,
    Enabled,
    ShowInStatusBar,
    RefreshIntervalMinutes,
    TimeoutSeconds,
    SortOrder,
    CreatedAt,
    UpdatedAt,
}
