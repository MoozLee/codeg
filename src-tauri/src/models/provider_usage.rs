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

/// Frontend-facing configuration row. `has_token` reflects keyring presence;
/// the token value itself is never returned.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsageConfigInfo {
    pub id: i32,
    pub name: String,
    pub query_kind: String,
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
            query_kind: m.query_kind,
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

/// Unified query result. Populated by PR2; PR1 only defines the shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsageResult {
    pub config_id: i32,
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
}
