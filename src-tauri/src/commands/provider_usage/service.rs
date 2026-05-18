//! Refresh orchestration for provider usage queries.
//!
//! `refresh_config_core` is the single entry point that every refresh path
//! funnels through: manual query, save-token follow-up, enable-on-create,
//! startup sweep, and the periodic auto-refresh task. It reads the DB row,
//! looks up the keyring token, runs the NewAPI query, writes the result to
//! `UsageCache`, and broadcasts `provider_usage:updated` so the frontend
//! state bar and settings list can react.
//!
//! `refresh_all_enabled` is invoked once at startup and arms the periodic
//! task for every `enabled` config with a positive `refresh_interval_minutes`.

use std::sync::Arc;
use std::time::Duration;

use sea_orm::DatabaseConnection;

use crate::db::service::provider_usage_config_service;
use crate::models::provider_usage::{decode_query_kinds, ProviderUsageResult, QueryKind};
use crate::web::event_bridge::{emit_event, EventEmitter};

use super::cache::UsageCache;
use super::newapi;

/// Event name the frontend subscribes to.
pub const PROVIDER_USAGE_UPDATED_EVENT: &str = "provider_usage:updated";

/// Resolve a DB config + keyring token into an `ExecConfig` and run the
/// corresponding NewAPI query. The result is always returned and also
/// written to the cache / broadcast to listeners.
pub async fn refresh_config_core(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    cache: &UsageCache,
    id: i32,
) -> ProviderUsageResult {
    let model = match provider_usage_config_service::get_by_id(conn, id).await {
        Ok(Some(m)) => m,
        Ok(None) => {
            let result = failure_result(id, "", "Config not found");
            cache.upsert(result.clone()).await;
            emit_event(emitter, PROVIDER_USAGE_UPDATED_EVENT, &result);
            return result;
        }
        Err(e) => {
            let result = failure_result(id, "", &format!("Failed to load config: {e}"));
            cache.upsert(result.clone()).await;
            emit_event(emitter, PROVIDER_USAGE_UPDATED_EVENT, &result);
            return result;
        }
    };

    let kind_strings = decode_query_kinds(&model.query_kinds);
    let kinds: Vec<QueryKind> = kind_strings
        .iter()
        .filter_map(|s| QueryKind::parse(s))
        .collect();
    if kinds.is_empty() {
        let result = failure_result(
            id,
            &kind_strings.join(","),
            "No valid query kinds configured",
        );
        cache.upsert(result.clone()).await;
        emit_event(emitter, PROVIDER_USAGE_UPDATED_EVENT, &result);
        return result;
    }

    let kinds_label = kinds
        .iter()
        .map(|k| k.as_str())
        .collect::<Vec<_>>()
        .join(",");

    let token = crate::keyring_store::get_provider_usage_token(id).unwrap_or_default();
    if token.is_empty() {
        let result = failure_result(id, &kinds_label, "Access token missing");
        cache.upsert(result.clone()).await;
        emit_event(emitter, PROVIDER_USAGE_UPDATED_EVENT, &result);
        return result;
    }

    let result = newapi::execute_kinds(
        id,
        &kinds,
        &model.base_url,
        &model.user_id,
        &token,
        model.timeout_seconds.max(1) as u64,
    )
    .await;

    cache.upsert(result.clone()).await;
    emit_event(emitter, PROVIDER_USAGE_UPDATED_EVENT, &result);
    result
}

/// Abort any existing refresh task, run an immediate refresh if the config
/// is enabled, and arm a fresh periodic task when `refresh_interval_minutes
/// > 0`. Safe to call after every CRUD operation that may change scheduling.
pub async fn reschedule_config(
    conn_arc: Arc<DatabaseConnection>,
    emitter: EventEmitter,
    cache: Arc<UsageCache>,
    id: i32,
) {
    cache.cancel_task(id).await;

    let model = match provider_usage_config_service::get_by_id(&conn_arc, id).await {
        Ok(Some(m)) => m,
        _ => {
            cache.remove(id).await;
            return;
        }
    };

    if !model.enabled {
        return;
    }

    let _ = refresh_config_core(&conn_arc, &emitter, &cache, id).await;

    let interval_minutes = model.refresh_interval_minutes;
    if interval_minutes > 0 {
        // `interval_minutes > 0` implies the cast is safe.
        start_auto_refresh(conn_arc, emitter, cache, id, interval_minutes as u64).await;
    }
}

/// Startup hook: one-shot refresh each enabled config and arm its periodic
/// task. Failures are captured inside `refresh_config_core` (they become
/// `success=false` results) so this function never returns an error.
pub async fn refresh_all_enabled(
    conn_arc: Arc<DatabaseConnection>,
    emitter: EventEmitter,
    cache: Arc<UsageCache>,
) {
    let rows = match provider_usage_config_service::list_all(&conn_arc).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[provider_usage] failed to load configs at startup: {e}");
            return;
        }
    };

    for row in rows {
        if !row.enabled {
            continue;
        }

        let _ = refresh_config_core(&conn_arc, &emitter, &cache, row.id).await;

        if row.refresh_interval_minutes > 0 {
            start_auto_refresh(
                conn_arc.clone(),
                emitter.clone(),
                cache.clone(),
                row.id,
                row.refresh_interval_minutes as u64,
            )
            .await;
        }
    }
}

/// Spawn a looping task that calls `refresh_config_core` every
/// `interval_minutes`. The returned `JoinHandle` is registered with
/// `UsageCache` so later CRUD operations can cancel it.
pub async fn start_auto_refresh(
    conn_arc: Arc<DatabaseConnection>,
    emitter: EventEmitter,
    cache: Arc<UsageCache>,
    id: i32,
    interval_minutes: u64,
) {
    if interval_minutes == 0 {
        return;
    }
    let cache_for_task = cache.clone();
    let handle = tokio::spawn(async move {
        let interval = Duration::from_secs(interval_minutes.saturating_mul(60).max(60));
        loop {
            tokio::time::sleep(interval).await;
            let _ = refresh_config_core(&conn_arc, &emitter, &cache_for_task, id).await;
        }
    });
    cache.register_task(id, handle).await;
}

fn failure_result(id: i32, kinds_label: &str, message: &str) -> ProviderUsageResult {
    ProviderUsageResult {
        config_id: id,
        query_kind: kinds_label.to_string(),
        success: false,
        plan_name: None,
        used: None,
        remaining: None,
        total: None,
        unit: "USD".to_string(),
        subscriptions: None,
        updated_at: chrono::Utc::now().to_rfc3339(),
        expires_at: None,
        message: Some(message.to_string()),
        balance: None,
        subscription: None,
    }
}
