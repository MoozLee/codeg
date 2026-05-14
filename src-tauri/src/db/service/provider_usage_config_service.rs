use chrono::Utc;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder, Set, Statement,
};

use crate::db::entities::provider_usage_config;
use crate::db::error::DbError;

#[allow(clippy::too_many_arguments)]
pub async fn create(
    conn: &DatabaseConnection,
    name: String,
    query_kinds: String,
    base_url: String,
    user_id: String,
    enabled: bool,
    show_in_status_bar: bool,
    refresh_interval_minutes: i32,
    timeout_seconds: i32,
    sort_order: i32,
) -> Result<provider_usage_config::Model, DbError> {
    let now = Utc::now();
    let active = provider_usage_config::ActiveModel {
        id: NotSet,
        name: Set(name),
        query_kinds: Set(query_kinds),
        base_url: Set(base_url),
        user_id: Set(user_id),
        enabled: Set(enabled),
        show_in_status_bar: Set(show_in_status_bar),
        refresh_interval_minutes: Set(refresh_interval_minutes),
        timeout_seconds: Set(timeout_seconds),
        sort_order: Set(sort_order),
        created_at: Set(now),
        updated_at: Set(now),
    };
    Ok(active.insert(conn).await?)
}

#[allow(clippy::too_many_arguments)]
pub async fn update(
    conn: &DatabaseConnection,
    id: i32,
    name: Option<String>,
    query_kinds: Option<String>,
    base_url: Option<String>,
    user_id: Option<String>,
    enabled: Option<bool>,
    show_in_status_bar: Option<bool>,
    refresh_interval_minutes: Option<i32>,
    timeout_seconds: Option<i32>,
    sort_order: Option<i32>,
) -> Result<provider_usage_config::Model, DbError> {
    let model = provider_usage_config::Entity::find_by_id(id)
        .one(conn)
        .await?
        .ok_or_else(|| DbError::Migration(format!("provider usage config not found: {id}")))?;

    let mut active = model.into_active_model();
    if let Some(v) = name {
        active.name = Set(v);
    }
    if let Some(v) = query_kinds {
        active.query_kinds = Set(v);
    }
    if let Some(v) = base_url {
        active.base_url = Set(v);
    }
    if let Some(v) = user_id {
        active.user_id = Set(v);
    }
    if let Some(v) = enabled {
        active.enabled = Set(v);
    }
    if let Some(v) = show_in_status_bar {
        active.show_in_status_bar = Set(v);
    }
    if let Some(v) = refresh_interval_minutes {
        active.refresh_interval_minutes = Set(v);
    }
    if let Some(v) = timeout_seconds {
        active.timeout_seconds = Set(v);
    }
    if let Some(v) = sort_order {
        active.sort_order = Set(v);
    }
    active.updated_at = Set(Utc::now());
    Ok(active.update(conn).await?)
}

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError> {
    provider_usage_config::Entity::delete_by_id(id)
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn get_by_id(
    conn: &DatabaseConnection,
    id: i32,
) -> Result<Option<provider_usage_config::Model>, DbError> {
    Ok(provider_usage_config::Entity::find_by_id(id)
        .one(conn)
        .await?)
}

pub async fn list_all(
    conn: &DatabaseConnection,
) -> Result<Vec<provider_usage_config::Model>, DbError> {
    Ok(provider_usage_config::Entity::find()
        .order_by_asc(provider_usage_config::Column::SortOrder)
        .order_by_asc(provider_usage_config::Column::Id)
        .all(conn)
        .await?)
}

/// Clear `show_in_status_bar` for every row except `except_id` (if provided).
/// Used to keep the global "status bar usage provider" unique.
pub async fn clear_show_in_status_bar(
    conn: &DatabaseConnection,
    except_id: Option<i32>,
) -> Result<(), DbError> {
    let mut query = provider_usage_config::Entity::update_many()
        .col_expr(
            provider_usage_config::Column::ShowInStatusBar,
            Expr::value(false),
        )
        .col_expr(
            provider_usage_config::Column::UpdatedAt,
            Expr::value(Utc::now()),
        )
        .filter(provider_usage_config::Column::ShowInStatusBar.eq(true));
    if let Some(id) = except_id {
        query = query.filter(provider_usage_config::Column::Id.ne(id));
    }
    query.exec(conn).await?;
    Ok(())
}

pub async fn reorder(conn: &DatabaseConnection, ids: &[i32]) -> Result<(), DbError> {
    if ids.is_empty() {
        return Ok(());
    }

    let now = Utc::now();
    let now_str = now.format("%Y-%m-%d %H:%M:%S %:z").to_string();
    let case_expr = ids
        .iter()
        .enumerate()
        .map(|(idx, id)| format!("WHEN {} THEN {}", id, idx))
        .collect::<Vec<_>>()
        .join(" ");
    let id_list = ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "UPDATE provider_usage_config SET sort_order = CASE id {case_expr} END, updated_at = '{now_str}' WHERE id IN ({id_list})"
    );
    conn.execute(Statement::from_string(DbBackend::Sqlite, sql))
        .await?;
    Ok(())
}
