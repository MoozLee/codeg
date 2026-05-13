use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "provider_usage_config")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub name: String,
    pub query_kind: String,
    #[sea_orm(column_type = "Text")]
    pub base_url: String,
    pub user_id: String,
    pub enabled: bool,
    pub show_in_status_bar: bool,
    pub refresh_interval_minutes: i32,
    pub timeout_seconds: i32,
    pub sort_order: i32,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
