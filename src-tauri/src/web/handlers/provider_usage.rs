use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::provider_usage as pu_commands;
use crate::models::provider_usage::{ProviderUsageConfigInfo, ProviderUsageResult};

// ---------------------------------------------------------------------------
// Param structs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProviderUsageConfigParams {
    pub name: String,
    pub query_kinds: Vec<String>,
    pub base_url: String,
    pub user_id: String,
    pub enabled: bool,
    pub show_in_status_bar: bool,
    pub refresh_interval_minutes: i32,
    pub timeout_seconds: i32,
    pub sort_order: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProviderUsageConfigParams {
    pub id: i32,
    pub name: Option<String>,
    pub query_kinds: Option<Vec<String>>,
    pub base_url: Option<String>,
    pub user_id: Option<String>,
    pub enabled: Option<bool>,
    pub show_in_status_bar: Option<bool>,
    pub refresh_interval_minutes: Option<i32>,
    pub timeout_seconds: Option<i32>,
    pub sort_order: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageIdParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderProviderUsageConfigsParams {
    pub ids: Vec<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProviderUsageTokenParams {
    pub id: i32,
    pub token: String,
}

#[derive(Deserialize)]
pub struct TestProviderUsageConfigRequest {
    // Matches the Tauri command's `{ input: { ... } }` envelope so the web
    // transport layer can reuse the exact same frontend wrapper. The inner
    // `TestProviderUsageConfigInput` already uses `rename_all = "camelCase"`.
    pub input: pu_commands::TestProviderUsageConfigInput,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn list_provider_usage_configs(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<Vec<ProviderUsageConfigInfo>>, AppCommandError> {
    let result = pu_commands::list_provider_usage_configs_core(&state.db).await?;
    Ok(Json(result))
}

pub async fn create_provider_usage_config(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CreateProviderUsageConfigParams>,
) -> Result<Json<ProviderUsageConfigInfo>, AppCommandError> {
    let result = pu_commands::create_provider_usage_config_core(
        &state.db,
        &state.emitter,
        &state.provider_usage_cache,
        params.name,
        params.query_kinds,
        params.base_url,
        params.user_id,
        params.enabled,
        params.show_in_status_bar,
        params.refresh_interval_minutes,
        params.timeout_seconds,
        params.sort_order,
    )
    .await?;
    Ok(Json(result))
}

pub async fn update_provider_usage_config(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpdateProviderUsageConfigParams>,
) -> Result<Json<ProviderUsageConfigInfo>, AppCommandError> {
    let result = pu_commands::update_provider_usage_config_core(
        &state.db,
        &state.emitter,
        &state.provider_usage_cache,
        params.id,
        params.name,
        params.query_kinds,
        params.base_url,
        params.user_id,
        params.enabled,
        params.show_in_status_bar,
        params.refresh_interval_minutes,
        params.timeout_seconds,
        params.sort_order,
    )
    .await?;
    Ok(Json(result))
}

pub async fn delete_provider_usage_config(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ProviderUsageIdParams>,
) -> Result<Json<()>, AppCommandError> {
    pu_commands::delete_provider_usage_config_core(
        &state.db,
        &state.provider_usage_cache,
        params.id,
    )
    .await?;
    Ok(Json(()))
}

pub async fn reorder_provider_usage_configs(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ReorderProviderUsageConfigsParams>,
) -> Result<Json<()>, AppCommandError> {
    pu_commands::reorder_provider_usage_configs_core(&state.db, params.ids).await?;
    Ok(Json(()))
}

pub async fn save_provider_usage_token(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SaveProviderUsageTokenParams>,
) -> Result<Json<()>, AppCommandError> {
    pu_commands::save_provider_usage_token_core(
        &state.db,
        &state.emitter,
        &state.provider_usage_cache,
        params.id,
        params.token,
    )
    .await?;
    Ok(Json(()))
}

pub async fn delete_provider_usage_token(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ProviderUsageIdParams>,
) -> Result<Json<()>, AppCommandError> {
    pu_commands::delete_provider_usage_token_core(
        &state.db,
        &state.emitter,
        &state.provider_usage_cache,
        params.id,
    )
    .await?;
    Ok(Json(()))
}

pub async fn test_provider_usage_config(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<TestProviderUsageConfigRequest>,
) -> Result<Json<ProviderUsageResult>, AppCommandError> {
    let result = pu_commands::test_provider_usage_config_core(&state.db, params.input).await?;
    Ok(Json(result))
}

pub async fn query_provider_usage(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ProviderUsageIdParams>,
) -> Result<Json<ProviderUsageResult>, AppCommandError> {
    let result = pu_commands::query_provider_usage_core(
        &state.db,
        &state.emitter,
        &state.provider_usage_cache,
        params.id,
    )
    .await?;
    Ok(Json(result))
}

pub async fn list_provider_usage_results(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<Vec<ProviderUsageResult>>, AppCommandError> {
    let result = pu_commands::list_provider_usage_results_core(&state.provider_usage_cache).await?;
    Ok(Json(result))
}
