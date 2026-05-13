//! Provider usage config CRUD + query commands.
//!
//! PR1 established the DB/keyring/wire shape; PR2 adds the outbound query,
//! cache, and auto-refresh. The split keeps the submodules narrow:
//!
//! - `url_safety` — SSRF guardrails for the NewAPI base URL.
//! - `newapi` — balance / subscription HTTP + JSON handling.
//! - `cache` — in-memory `ProviderUsageResult` store + refresh task handles.
//! - `service` — the single `refresh_config_core` path used by manual query,
//!   auto-refresh, and CRUD follow-ups.
//!
//! Everything surfaced via `#[tauri::command]` and Axum handlers funnels
//! through one of the `*_core` functions below so desktop + server modes
//! share semantics.

pub mod cache;
pub mod newapi;
pub mod service;
pub mod url_safety;

use std::sync::Arc;

use sea_orm::DatabaseConnection;

use crate::app_error::AppCommandError;
use crate::db::service::provider_usage_config_service;
use crate::db::AppDatabase;
use crate::models::provider_usage::{
    ProviderUsageConfigInfo, ProviderUsageResult, QueryKind,
};
use crate::web::event_bridge::EventEmitter;

pub use cache::UsageCache;
pub use service::PROVIDER_USAGE_UPDATED_EVENT;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NAME_LEN: usize = 128;
const MAX_USER_ID_LEN: usize = 128;
const MAX_TOKEN_LEN: usize = 4096;
const MIN_TIMEOUT_SECONDS: i32 = 2;
const MAX_TIMEOUT_SECONDS: i32 = 30;
const MAX_REFRESH_INTERVAL_MINUTES: i32 = 24 * 60;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn validate_name(name: &str) -> Result<(), AppCommandError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppCommandError::invalid_input("Name cannot be empty"));
    }
    if name.len() > MAX_NAME_LEN {
        return Err(AppCommandError::invalid_input(format!(
            "Name must be {MAX_NAME_LEN} characters or less"
        )));
    }
    Ok(())
}

fn validate_query_kind(query_kind: &str) -> Result<QueryKind, AppCommandError> {
    QueryKind::parse(query_kind).ok_or_else(|| {
        AppCommandError::invalid_input(format!("Invalid query kind: {query_kind}"))
    })
}

fn validate_user_id(user_id: &str) -> Result<(), AppCommandError> {
    let trimmed = user_id.trim();
    if trimmed.is_empty() {
        return Err(AppCommandError::invalid_input("User ID cannot be empty"));
    }
    if user_id.len() > MAX_USER_ID_LEN {
        return Err(AppCommandError::invalid_input(format!(
            "User ID must be {MAX_USER_ID_LEN} characters or less"
        )));
    }
    Ok(())
}

fn validate_timeout_seconds(seconds: i32) -> Result<(), AppCommandError> {
    if !(MIN_TIMEOUT_SECONDS..=MAX_TIMEOUT_SECONDS).contains(&seconds) {
        return Err(AppCommandError::invalid_input(format!(
            "timeoutSeconds must be between {MIN_TIMEOUT_SECONDS} and {MAX_TIMEOUT_SECONDS}"
        )));
    }
    Ok(())
}

fn validate_refresh_interval(minutes: i32) -> Result<(), AppCommandError> {
    if !(0..=MAX_REFRESH_INTERVAL_MINUTES).contains(&minutes) {
        return Err(AppCommandError::invalid_input(format!(
            "refreshIntervalMinutes must be between 0 and {MAX_REFRESH_INTERVAL_MINUTES}"
        )));
    }
    Ok(())
}

fn validate_token(token: &str) -> Result<(), AppCommandError> {
    if token.is_empty() {
        return Err(AppCommandError::invalid_input("Token cannot be empty"));
    }
    if token.len() > MAX_TOKEN_LEN {
        return Err(AppCommandError::invalid_input(format!(
            "Token must be {MAX_TOKEN_LEN} characters or less"
        )));
    }
    Ok(())
}

fn attach_token_flag(mut info: ProviderUsageConfigInfo) -> ProviderUsageConfigInfo {
    info.has_token = crate::keyring_store::get_provider_usage_token(info.id).is_some();
    info
}

// ---------------------------------------------------------------------------
// Shared core functions (used by both Tauri commands and web handlers)
// ---------------------------------------------------------------------------

pub async fn list_provider_usage_configs_core(
    db: &AppDatabase,
) -> Result<Vec<ProviderUsageConfigInfo>, AppCommandError> {
    let rows = provider_usage_config_service::list_all(&db.conn)
        .await
        .map_err(AppCommandError::from)?;
    Ok(rows
        .into_iter()
        .map(ProviderUsageConfigInfo::from)
        .map(attach_token_flag)
        .collect())
}

#[allow(clippy::too_many_arguments)]
pub async fn create_provider_usage_config_core(
    db: &AppDatabase,
    emitter: &EventEmitter,
    cache: &Arc<UsageCache>,
    name: String,
    query_kind: String,
    base_url: String,
    user_id: String,
    enabled: bool,
    show_in_status_bar: bool,
    refresh_interval_minutes: i32,
    timeout_seconds: i32,
    sort_order: i32,
) -> Result<ProviderUsageConfigInfo, AppCommandError> {
    validate_name(&name)?;
    let kind = validate_query_kind(&query_kind)?;
    url_safety::ensure_https_url(&base_url)?;
    validate_user_id(&user_id)?;
    validate_timeout_seconds(timeout_seconds)?;
    validate_refresh_interval(refresh_interval_minutes)?;

    if show_in_status_bar {
        provider_usage_config_service::clear_show_in_status_bar(&db.conn, None)
            .await
            .map_err(AppCommandError::from)?;
    }

    let model = provider_usage_config_service::create(
        &db.conn,
        name,
        kind.as_str().to_string(),
        base_url,
        user_id,
        enabled,
        show_in_status_bar,
        refresh_interval_minutes,
        timeout_seconds,
        sort_order,
    )
    .await
    .map_err(AppCommandError::from)?;

    let info = attach_token_flag(ProviderUsageConfigInfo::from(model.clone()));
    let id = model.id;

    if enabled {
        schedule_after_mutation(db, emitter, cache, id).await;
    }

    Ok(info)
}

#[allow(clippy::too_many_arguments)]
pub async fn update_provider_usage_config_core(
    db: &AppDatabase,
    emitter: &EventEmitter,
    cache: &Arc<UsageCache>,
    id: i32,
    name: Option<String>,
    query_kind: Option<String>,
    base_url: Option<String>,
    user_id: Option<String>,
    enabled: Option<bool>,
    show_in_status_bar: Option<bool>,
    refresh_interval_minutes: Option<i32>,
    timeout_seconds: Option<i32>,
    sort_order: Option<i32>,
) -> Result<ProviderUsageConfigInfo, AppCommandError> {
    if let Some(v) = name.as_deref() {
        validate_name(v)?;
    }
    let kind_string = if let Some(v) = query_kind.as_deref() {
        Some(validate_query_kind(v)?.as_str().to_string())
    } else {
        None
    };
    if let Some(v) = base_url.as_deref() {
        url_safety::ensure_https_url(v)?;
    }
    if let Some(v) = user_id.as_deref() {
        validate_user_id(v)?;
    }
    if let Some(v) = timeout_seconds {
        validate_timeout_seconds(v)?;
    }
    if let Some(v) = refresh_interval_minutes {
        validate_refresh_interval(v)?;
    }

    if show_in_status_bar == Some(true) {
        provider_usage_config_service::clear_show_in_status_bar(&db.conn, Some(id))
            .await
            .map_err(AppCommandError::from)?;
    }

    let model = provider_usage_config_service::update(
        &db.conn,
        id,
        name,
        kind_string,
        base_url,
        user_id,
        enabled,
        show_in_status_bar,
        refresh_interval_minutes,
        timeout_seconds,
        sort_order,
    )
    .await
    .map_err(AppCommandError::from)?;

    let info = attach_token_flag(ProviderUsageConfigInfo::from(model.clone()));

    // Any update may have changed enabled/interval/base_url/kind, so always
    // reschedule. `reschedule_config` handles "disabled → no-op + clean up",
    // "enabled → immediate refresh + arm timer", and interval changes.
    schedule_after_mutation(db, emitter, cache, id).await;

    Ok(info)
}

pub async fn delete_provider_usage_config_core(
    db: &AppDatabase,
    cache: &Arc<UsageCache>,
    id: i32,
) -> Result<(), AppCommandError> {
    // Best-effort token cleanup first so a stray keyring entry never outlives
    // its DB row. Keyring errors are surfaced so the caller can retry.
    crate::keyring_store::delete_provider_usage_token(id).map_err(|e| {
        AppCommandError::io_error("Failed to delete provider usage token").with_detail(e)
    })?;

    provider_usage_config_service::delete(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?;

    cache.remove(id).await;
    Ok(())
}

pub async fn reorder_provider_usage_configs_core(
    db: &AppDatabase,
    ids: Vec<i32>,
) -> Result<(), AppCommandError> {
    provider_usage_config_service::reorder(&db.conn, &ids)
        .await
        .map_err(AppCommandError::from)?;
    Ok(())
}

pub async fn save_provider_usage_token_core(
    db: &AppDatabase,
    emitter: &EventEmitter,
    cache: &Arc<UsageCache>,
    id: i32,
    token: String,
) -> Result<(), AppCommandError> {
    validate_token(&token)?;
    let existing = provider_usage_config_service::get_by_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?;
    let Some(existing) = existing else {
        return Err(AppCommandError::not_found(format!(
            "provider usage config not found: {id}"
        )));
    };

    crate::keyring_store::set_provider_usage_token(id, &token).map_err(|e| {
        AppCommandError::io_error("Failed to save provider usage token").with_detail(e)
    })?;

    if existing.enabled {
        schedule_after_mutation(db, emitter, cache, id).await;
    }
    Ok(())
}

pub async fn delete_provider_usage_token_core(
    db: &AppDatabase,
    emitter: &EventEmitter,
    cache: &Arc<UsageCache>,
    id: i32,
) -> Result<(), AppCommandError> {
    crate::keyring_store::delete_provider_usage_token(id).map_err(|e| {
        AppCommandError::io_error("Failed to delete provider usage token").with_detail(e)
    })?;

    // Token just went missing — re-run the refresh path so the cache reflects
    // "Access token missing" instead of the last successful snapshot.
    if let Ok(Some(existing)) = provider_usage_config_service::get_by_id(&db.conn, id).await {
        if existing.enabled {
            schedule_after_mutation(db, emitter, cache, id).await;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Query / test / cache entry points
// ---------------------------------------------------------------------------

/// Parameters accepted by `test_provider_usage_config`. Supports an unsaved
/// draft (no `id`) so the settings UI can validate inputs before persisting.
///
/// The frontend sends camelCase keys both via Tauri `invoke` (inside an
/// `{ input: { ... } }` envelope) and via the web handler (same envelope
/// after the handler unwraps it), so we mirror the convention with
/// `rename_all = "camelCase"` to keep a single cross-layer contract.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProviderUsageConfigInput {
    pub id: Option<i32>,
    pub query_kind: String,
    pub base_url: String,
    pub user_id: String,
    pub timeout_seconds: i32,
    /// When `None`, the server falls back to the saved keyring token for
    /// `id` (if any).
    pub token: Option<String>,
}

pub async fn test_provider_usage_config_core(
    db: &AppDatabase,
    input: TestProviderUsageConfigInput,
) -> Result<ProviderUsageResult, AppCommandError> {
    validate_timeout_seconds(input.timeout_seconds)?;

    let (kind, base_url, user_id, token, config_id) = if let Some(id) = input.id {
        let Some(model) = provider_usage_config_service::get_by_id(&db.conn, id)
            .await
            .map_err(AppCommandError::from)?
        else {
            return Err(AppCommandError::not_found(format!(
                "provider usage config not found: {id}"
            )));
        };

        // Draft overrides win when the UI has unsaved edits it wants to try.
        let kind_str = if input.query_kind.is_empty() {
            model.query_kind.clone()
        } else {
            input.query_kind.clone()
        };
        let kind = validate_query_kind(&kind_str)?;

        let base_url = if input.base_url.is_empty() {
            model.base_url.clone()
        } else {
            input.base_url.clone()
        };
        url_safety::ensure_https_url(&base_url)?;

        let user_id = if input.user_id.is_empty() {
            model.user_id.clone()
        } else {
            input.user_id.clone()
        };
        validate_user_id(&user_id)?;

        let token = match input.token {
            Some(t) if !t.is_empty() => {
                validate_token(&t)?;
                t
            }
            _ => crate::keyring_store::get_provider_usage_token(id).unwrap_or_default(),
        };

        (kind, base_url, user_id, token, id)
    } else {
        let kind = validate_query_kind(&input.query_kind)?;
        url_safety::ensure_https_url(&input.base_url)?;
        validate_user_id(&input.user_id)?;
        let token = input.token.clone().ok_or_else(|| {
            AppCommandError::invalid_input("Token is required for draft test")
        })?;
        validate_token(&token)?;
        (kind, input.base_url, input.user_id, token, 0)
    };

    if token.is_empty() {
        return Err(AppCommandError::invalid_input("Access token missing"));
    }

    let cfg = newapi::ExecConfig {
        config_id,
        query_kind: kind,
        base_url,
        user_id,
        token,
        timeout_seconds: input.timeout_seconds.max(1) as u64,
    };

    let result = match kind {
        QueryKind::NewapiBalance => newapi::query_newapi_balance(&cfg).await,
        QueryKind::NewapiSubscription => newapi::query_newapi_subscription(&cfg).await,
    };

    Ok(result)
}

pub async fn query_provider_usage_core(
    db: &AppDatabase,
    emitter: &EventEmitter,
    cache: &Arc<UsageCache>,
    id: i32,
) -> Result<ProviderUsageResult, AppCommandError> {
    let exists = provider_usage_config_service::get_by_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?
        .is_some();
    if !exists {
        return Err(AppCommandError::not_found(format!(
            "provider usage config not found: {id}"
        )));
    }

    Ok(service::refresh_config_core(&db.conn, emitter, cache, id).await)
}

pub async fn list_provider_usage_results_core(
    cache: &Arc<UsageCache>,
) -> Result<Vec<ProviderUsageResult>, AppCommandError> {
    Ok(cache.get_all().await)
}

// ---------------------------------------------------------------------------
// Scheduling helpers
// ---------------------------------------------------------------------------

/// Wrap `service::reschedule_config` so callers can pass a `&AppDatabase`
/// without caring that the inner task needs an owned `Arc<DatabaseConnection>`.
async fn schedule_after_mutation(
    db: &AppDatabase,
    emitter: &EventEmitter,
    cache: &Arc<UsageCache>,
    id: i32,
) {
    let conn_arc = Arc::new(db.conn.clone());
    service::reschedule_config(conn_arc, emitter.clone(), cache.clone(), id).await;
}

/// Initial refresh sweep used by both desktop and server entry points.
///
/// Caller decides which runtime to spawn this on. Tauri must use
/// `tauri::async_runtime::spawn` (the synchronous `setup` callback has no
/// ambient Tokio reactor and `tokio::spawn` would panic with "there is no
/// reactor running"); the server binary runs inside `#[tokio::main]`, so a
/// plain `tokio::spawn` is fine there.
pub async fn initial_refresh_sweep(
    conn: DatabaseConnection,
    emitter: EventEmitter,
    cache: Arc<UsageCache>,
) {
    let conn_arc = Arc::new(conn);
    service::refresh_all_enabled(conn_arc, emitter, cache).await;
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn list_provider_usage_configs(
    db: tauri::State<'_, AppDatabase>,
) -> Result<Vec<ProviderUsageConfigInfo>, AppCommandError> {
    list_provider_usage_configs_core(&db).await
}

#[allow(clippy::too_many_arguments)]
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn create_provider_usage_config(
    db: tauri::State<'_, AppDatabase>,
    cache: tauri::State<'_, Arc<UsageCache>>,
    app: tauri::AppHandle,
    name: String,
    query_kind: String,
    base_url: String,
    user_id: String,
    enabled: bool,
    show_in_status_bar: bool,
    refresh_interval_minutes: i32,
    timeout_seconds: i32,
    sort_order: i32,
) -> Result<ProviderUsageConfigInfo, AppCommandError> {
    let emitter = EventEmitter::Tauri(app);
    create_provider_usage_config_core(
        &db,
        &emitter,
        cache.inner(),
        name,
        query_kind,
        base_url,
        user_id,
        enabled,
        show_in_status_bar,
        refresh_interval_minutes,
        timeout_seconds,
        sort_order,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn update_provider_usage_config(
    db: tauri::State<'_, AppDatabase>,
    cache: tauri::State<'_, Arc<UsageCache>>,
    app: tauri::AppHandle,
    id: i32,
    name: Option<String>,
    query_kind: Option<String>,
    base_url: Option<String>,
    user_id: Option<String>,
    enabled: Option<bool>,
    show_in_status_bar: Option<bool>,
    refresh_interval_minutes: Option<i32>,
    timeout_seconds: Option<i32>,
    sort_order: Option<i32>,
) -> Result<ProviderUsageConfigInfo, AppCommandError> {
    let emitter = EventEmitter::Tauri(app);
    update_provider_usage_config_core(
        &db,
        &emitter,
        cache.inner(),
        id,
        name,
        query_kind,
        base_url,
        user_id,
        enabled,
        show_in_status_bar,
        refresh_interval_minutes,
        timeout_seconds,
        sort_order,
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn delete_provider_usage_config(
    db: tauri::State<'_, AppDatabase>,
    cache: tauri::State<'_, Arc<UsageCache>>,
    id: i32,
) -> Result<(), AppCommandError> {
    delete_provider_usage_config_core(&db, cache.inner(), id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn reorder_provider_usage_configs(
    db: tauri::State<'_, AppDatabase>,
    ids: Vec<i32>,
) -> Result<(), AppCommandError> {
    reorder_provider_usage_configs_core(&db, ids).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn save_provider_usage_token(
    db: tauri::State<'_, AppDatabase>,
    cache: tauri::State<'_, Arc<UsageCache>>,
    app: tauri::AppHandle,
    id: i32,
    token: String,
) -> Result<(), AppCommandError> {
    let emitter = EventEmitter::Tauri(app);
    save_provider_usage_token_core(&db, &emitter, cache.inner(), id, token).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn delete_provider_usage_token(
    db: tauri::State<'_, AppDatabase>,
    cache: tauri::State<'_, Arc<UsageCache>>,
    app: tauri::AppHandle,
    id: i32,
) -> Result<(), AppCommandError> {
    let emitter = EventEmitter::Tauri(app);
    delete_provider_usage_token_core(&db, &emitter, cache.inner(), id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn test_provider_usage_config(
    db: tauri::State<'_, AppDatabase>,
    input: TestProviderUsageConfigInput,
) -> Result<ProviderUsageResult, AppCommandError> {
    test_provider_usage_config_core(&db, input).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn query_provider_usage(
    db: tauri::State<'_, AppDatabase>,
    cache: tauri::State<'_, Arc<UsageCache>>,
    app: tauri::AppHandle,
    id: i32,
) -> Result<ProviderUsageResult, AppCommandError> {
    let emitter = EventEmitter::Tauri(app);
    query_provider_usage_core(&db, &emitter, cache.inner(), id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn list_provider_usage_results(
    cache: tauri::State<'_, Arc<UsageCache>>,
) -> Result<Vec<ProviderUsageResult>, AppCommandError> {
    list_provider_usage_results_core(cache.inner()).await
}
