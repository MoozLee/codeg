use serde::{Deserialize, Serialize};

use crate::db::entities::provider_usage_config;

/// Supported query kinds. Serialized as snake_case strings to match the rest of
/// the project's enum wire format (e.g. `AgentType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryKind {
    NewapiBalance,
    NewapiSubscription,
}

impl QueryKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            QueryKind::NewapiBalance => "newapi_balance",
            QueryKind::NewapiSubscription => "newapi_subscription",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "newapi_balance" => Some(QueryKind::NewapiBalance),
            "newapi_subscription" => Some(QueryKind::NewapiSubscription),
            _ => None,
        }
    }
}

/// Decode a JSON-encoded query-kinds array (stored on disk as `TEXT`) into a
/// typed list. Returns an empty list when the value is missing/empty/invalid
/// so callers can surface a friendly validation error instead of hard-failing
/// on stale rows.
pub fn decode_query_kinds(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if let Ok(list) = serde_json::from_str::<Vec<String>>(trimmed) {
        return list;
    }
    // Defensive: accept a comma-delimited fallback so developer DBs created
    // before JSON encoding still parse.
    trimmed
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn encode_query_kinds(kinds: &[String]) -> String {
    serde_json::to_string(kinds).unwrap_or_else(|_| "[]".to_string())
}

/// Frontend-facing configuration row. `has_token` reflects keyring presence;
/// the token value itself is never returned.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsageConfigInfo {
    pub id: i32,
    pub name: String,
    pub query_kinds: Vec<String>,
    pub base_url: String,
    pub user_id: String,
    pub enabled: bool,
    pub show_in_status_bar: bool,
    pub refresh_interval_minutes: i32,
    pub timeout_seconds: i32,
    pub sort_order: i32,
    pub has_token: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl From<provider_usage_config::Model> for ProviderUsageConfigInfo {
    fn from(m: provider_usage_config::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            query_kinds: decode_query_kinds(&m.query_kinds),
            base_url: m.base_url,
            user_id: m.user_id,
            enabled: m.enabled,
            show_in_status_bar: m.show_in_status_bar,
            refresh_interval_minutes: m.refresh_interval_minutes,
            timeout_seconds: m.timeout_seconds,
            sort_order: m.sort_order,
            has_token: false,
            created_at: m.created_at.to_rfc3339(),
            updated_at: m.updated_at.to_rfc3339(),
        }
    }
}

/// A single subscription/plan line item inside a `ProviderUsageResult` payload.
/// Used by `newapi_subscription` results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsageSubscriptionItem {
    pub plan_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

/// Per-kind amount slice inside an aggregated `ProviderUsageResult`. When a
/// config queries multiple kinds (e.g. balance + subscription), each kind's
/// per-kind outcome is preserved here while the top-level fields expose the
/// summed values for a single status-bar line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsageAmount {
    pub success: bool,
    pub query_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    pub unit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscriptions: Option<Vec<ProviderUsageSubscriptionItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Unified query result. When a config enables multiple `query_kinds`, the
/// top-level totals are the sum of the per-kind `balance` / `subscription`
/// slices; consumers that want per-kind detail read the nested fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsageResult {
    pub config_id: i32,
    /// Comma-delimited list of the kinds that contributed to this result
    /// (e.g. `"newapi_balance"`, `"newapi_subscription"`, or both joined
    /// with `","`). Kept for backwards compatibility with PR1 wire shape.
    pub query_kind: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    pub unit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscriptions: Option<Vec<ProviderUsageSubscriptionItem>>,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub balance: Option<ProviderUsageAmount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription: Option<ProviderUsageAmount>,
}
