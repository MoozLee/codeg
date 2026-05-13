//! NewAPI (cc-switch style) balance + subscription query helpers.
//!
//! Every error path returns a populated `ProviderUsageResult` with
//! `success = false` — we never surface an `AppCommandError` here. The
//! frontend renders failed queries as tooltip text in the status bar and a
//! red badge in the settings list; throwing a generic command error would
//! replace that with an unhelpful toast.
//!
//! Documentation references (`.trellis/tasks/.../research/newapi-balance-subscription.md`):
//!
//! - Balance: `GET {base_url}/api/user/self` → `data.quota`, `data.used_quota`,
//!   `data.group`. All quota values divide by `500_000` to convert to USD.
//! - Subscription: `GET {base_url}/api/subscription/self` →
//!   `data.subscriptions` (or `data.all_subscriptions`). Each item with a
//!   non-null `subscription` contributes `amount_total` / `amount_used`.

use std::time::Duration;

use chrono::Utc;
use serde::Deserialize;

use crate::models::provider_usage::{
    ProviderUsageResult, ProviderUsageSubscriptionItem, QueryKind,
};

use super::url_safety::ensure_https_url;

/// Max response body size accepted from NewAPI. 1 MiB is more than enough for
/// the balance/subscription JSON payloads and cuts off hostile/confused
/// endpoints streaming megabytes of HTML.
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const USD_DIVISOR: f64 = 500_000.0;
const UNIT_USD: &str = "USD";
const USER_AGENT: &str = concat!("codeg/", env!("CARGO_PKG_VERSION"));

/// Config struct passed to the NewAPI query functions. Kept internal so we
/// can evolve the shape without touching the public API.
#[derive(Debug, Clone)]
pub struct ExecConfig {
    pub config_id: i32,
    pub query_kind: QueryKind,
    pub base_url: String,
    pub user_id: String,
    pub token: String,
    pub timeout_seconds: u64,
}

pub async fn query_newapi_balance(cfg: &ExecConfig) -> ProviderUsageResult {
    execute_query(cfg, "/api/user/self", parse_balance_body).await
}

pub async fn query_newapi_subscription(cfg: &ExecConfig) -> ProviderUsageResult {
    execute_query(cfg, "/api/subscription/self", parse_subscription_body).await
}

/// Shared request/response pipeline. `parse` receives the raw JSON value of
/// the top-level response and the API's `success`/`message` fields so it can
/// emit per-query-kind semantics without duplicating HTTP plumbing.
async fn execute_query<F>(cfg: &ExecConfig, path: &str, parse: F) -> ProviderUsageResult
where
    F: FnOnce(&ExecConfig, NewApiEnvelope) -> ProviderUsageResult,
{
    let parsed_url = match ensure_https_url(&cfg.base_url) {
        Ok(url) => url,
        Err(e) => return failure(cfg, &e.message),
    };

    // Simple `{base_url}{path}` concat (cc-switch template semantics) —
    // `Url::join` with an absolute path would strip a user-provided
    // `/v1` prefix, which real deployments sometimes rely on.
    let base_trimmed = parsed_url.as_str().trim_end_matches('/');
    let full_url = format!("{base_trimmed}{path}");

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(cfg.timeout_seconds.max(1)))
        .https_only(true)
        .build()
    {
        Ok(c) => c,
        Err(e) => return failure(cfg, &format!("HTTP client error: {e}")),
    };

    let response = match client
        .get(full_url)
        .header("Authorization", format!("Bearer {}", cfg.token))
        .header("New-Api-User", &cfg.user_id)
        .header("Content-Type", "application/json")
        .header("User-Agent", USER_AGENT)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return failure(cfg, &format!("Network error: {e}")),
    };

    let status = response.status();
    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => return failure(cfg, &format!("Failed to read response: {e}")),
    };

    if bytes.len() > MAX_RESPONSE_BYTES {
        return failure(cfg, "Response body too large");
    }

    // Try to decode the unified envelope first; fall back to HTTP-status
    // reporting when the body isn't JSON-shaped like we expect.
    let envelope: NewApiEnvelope = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            if !status.is_success() {
                return failure(cfg, &format!("HTTP {}", status.as_u16()));
            }
            return failure(cfg, &format!("Failed to parse response: {e}"));
        }
    };

    // Even with a parsable body, propagate non-2xx upstream failures unless
    // the envelope already carries an explicit `success=false, message=...`.
    if !status.is_success() && envelope.success != Some(false) {
        let msg = envelope
            .message
            .clone()
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        return failure(cfg, &msg);
    }

    parse(cfg, envelope)
}

/// Generic NewAPI response envelope. Keep `data` as `serde_json::Value` so
/// each query kind can pick fields out without exhaustively typing them.
#[derive(Debug, Clone, Deserialize)]
struct NewApiEnvelope {
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

fn parse_balance_body(cfg: &ExecConfig, env: NewApiEnvelope) -> ProviderUsageResult {
    if env.success != Some(true) {
        let msg = env
            .message
            .clone()
            .unwrap_or_else(|| "Query failed".to_string());
        return failure(cfg, &msg);
    }

    let Some(data) = env.data.as_ref() else {
        return failure(cfg, "Missing data payload");
    };

    // NewAPI returns integer cents; also accept floats defensively.
    let quota = data.get("quota").and_then(number_from_value);
    let used_quota = data.get("used_quota").and_then(number_from_value);
    let group = data
        .get("group")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let (remaining, used, total) = match (quota, used_quota) {
        (Some(q), Some(u)) => (Some(q / USD_DIVISOR), Some(u / USD_DIVISOR), Some((q + u) / USD_DIVISOR)),
        (Some(q), None) => (Some(q / USD_DIVISOR), None, Some(q / USD_DIVISOR)),
        (None, Some(u)) => (None, Some(u / USD_DIVISOR), None),
        (None, None) => (None, None, None),
    };

    ProviderUsageResult {
        config_id: cfg.config_id,
        query_kind: cfg.query_kind.as_str().to_string(),
        success: true,
        plan_name: group,
        used,
        remaining,
        total,
        unit: UNIT_USD.to_string(),
        subscriptions: None,
        updated_at: now_rfc3339(),
        expires_at: None,
        message: None,
    }
}

fn parse_subscription_body(cfg: &ExecConfig, env: NewApiEnvelope) -> ProviderUsageResult {
    let data = env.data.clone();

    let subs = data
        .as_ref()
        .and_then(|d| {
            d.get("subscriptions")
                .and_then(|v| v.as_array())
                .or_else(|| d.get("all_subscriptions").and_then(|v| v.as_array()))
        })
        .cloned()
        .unwrap_or_default();

    let valid: Vec<&serde_json::Value> = subs
        .iter()
        .filter(|item| {
            item.get("subscription")
                .is_some_and(|v| !v.is_null())
        })
        .collect();

    if env.success != Some(true) || valid.is_empty() {
        let msg = env
            .message
            .clone()
            .unwrap_or_else(|| "Query failed".to_string());
        return failure(cfg, &msg);
    }

    let mut total_amount = 0.0_f64;
    let mut used_amount = 0.0_f64;
    let mut plan_titles: Vec<String> = Vec::new();
    let mut items: Vec<ProviderUsageSubscriptionItem> = Vec::new();
    let mut latest_end_time: Option<i64> = None;

    for item in &valid {
        let amount_total = item
            .get("amount_total")
            .and_then(number_from_value)
            .unwrap_or(0.0);
        let amount_used = item
            .get("amount_used")
            .and_then(number_from_value)
            .unwrap_or(0.0);
        total_amount += amount_total;
        used_amount += amount_used;

        let plan_title = item
            .get("plan_title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(title) = plan_title.clone() {
            if !title.is_empty() {
                plan_titles.push(title);
            }
        }

        let item_total_usd = amount_total / USD_DIVISOR;
        let item_used_usd = amount_used / USD_DIVISOR;
        let item_remaining_usd = (amount_total - amount_used) / USD_DIVISOR;

        let end_time = item.get("end_time").and_then(number_from_value);
        if let Some(end_ts) = end_time {
            let end_ts_i = end_ts as i64;
            latest_end_time = Some(match latest_end_time {
                Some(existing) => existing.max(end_ts_i),
                None => end_ts_i,
            });
        }

        let expires_at = end_time.and_then(|ts| epoch_to_rfc3339(ts as i64));

        items.push(ProviderUsageSubscriptionItem {
            plan_name: plan_title.unwrap_or_else(|| "default".to_string()),
            used: Some(item_used_usd),
            remaining: Some(item_remaining_usd),
            total: Some(item_total_usd),
            expires_at,
        });
    }

    let plan_name = if plan_titles.is_empty() {
        "default".to_string()
    } else {
        plan_titles.join(" + ")
    };

    let total_usd = total_amount / USD_DIVISOR;
    let used_usd = used_amount / USD_DIVISOR;
    let remaining_usd = (total_amount - used_amount) / USD_DIVISOR;
    let expires_at = latest_end_time.and_then(epoch_to_rfc3339);

    ProviderUsageResult {
        config_id: cfg.config_id,
        query_kind: cfg.query_kind.as_str().to_string(),
        success: true,
        plan_name: Some(plan_name),
        used: Some(used_usd),
        remaining: Some(remaining_usd),
        total: Some(total_usd),
        unit: UNIT_USD.to_string(),
        subscriptions: Some(items),
        updated_at: now_rfc3339(),
        expires_at,
        message: None,
    }
}

fn failure(cfg: &ExecConfig, message: &str) -> ProviderUsageResult {
    ProviderUsageResult {
        config_id: cfg.config_id,
        query_kind: cfg.query_kind.as_str().to_string(),
        success: false,
        plan_name: None,
        used: None,
        remaining: None,
        total: None,
        unit: UNIT_USD.to_string(),
        subscriptions: None,
        updated_at: now_rfc3339(),
        expires_at: None,
        message: Some(message.to_string()),
    }
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn number_from_value(v: &serde_json::Value) -> Option<f64> {
    if let Some(n) = v.as_f64() {
        return Some(n);
    }
    if let Some(i) = v.as_i64() {
        return Some(i as f64);
    }
    if let Some(u) = v.as_u64() {
        return Some(u as f64);
    }
    None
}

fn epoch_to_rfc3339(secs: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0).map(|dt| dt.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(kind: QueryKind) -> ExecConfig {
        ExecConfig {
            config_id: 1,
            query_kind: kind,
            base_url: "https://api.example.com".to_string(),
            user_id: "u1".to_string(),
            token: "t".to_string(),
            timeout_seconds: 5,
        }
    }

    #[test]
    fn balance_parses_happy_path() {
        let env: NewApiEnvelope = serde_json::from_str(
            r#"{"success":true,"data":{"quota":500000,"used_quota":250000,"group":"vip"}}"#,
        )
        .unwrap();
        let result = parse_balance_body(&cfg(QueryKind::NewapiBalance), env);
        assert!(result.success);
        assert_eq!(result.plan_name.as_deref(), Some("vip"));
        assert_eq!(result.remaining, Some(1.0));
        assert_eq!(result.used, Some(0.5));
        assert_eq!(result.total, Some(1.5));
        assert_eq!(result.unit, "USD");
    }

    #[test]
    fn balance_failure_propagates_message() {
        let env: NewApiEnvelope =
            serde_json::from_str(r#"{"success":false,"message":"bad token"}"#).unwrap();
        let result = parse_balance_body(&cfg(QueryKind::NewapiBalance), env);
        assert!(!result.success);
        assert_eq!(result.message.as_deref(), Some("bad token"));
    }

    #[test]
    fn balance_missing_data_is_failure() {
        let env: NewApiEnvelope = serde_json::from_str(r#"{"success":true}"#).unwrap();
        let result = parse_balance_body(&cfg(QueryKind::NewapiBalance), env);
        assert!(!result.success);
    }

    #[test]
    fn subscription_aggregates_valid_items() {
        let body = r#"{
            "success": true,
            "data": {
                "subscriptions": [
                    {
                        "subscription": { "id": 1 },
                        "amount_total": 1000000,
                        "amount_used": 250000,
                        "plan_title": "Gold",
                        "end_time": 1700000000
                    },
                    {
                        "subscription": null,
                        "amount_total": 999999999,
                        "amount_used": 0,
                        "plan_title": "Inactive"
                    },
                    {
                        "subscription": { "id": 2 },
                        "amount_total": 500000,
                        "amount_used": 100000,
                        "plan_title": "Silver",
                        "end_time": 1800000000
                    }
                ]
            }
        }"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let result = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(result.success);
        assert_eq!(result.plan_name.as_deref(), Some("Gold + Silver"));
        assert_eq!(result.total, Some(3.0));
        assert_eq!(result.used, Some(0.7));
        assert_eq!(result.remaining, Some(2.3));
        let items = result.subscriptions.as_ref().expect("items present");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].plan_name, "Gold");
        assert!(result.expires_at.is_some());
    }

    #[test]
    fn subscription_falls_back_to_all_subscriptions() {
        let body = r#"{
            "success": true,
            "data": {
                "all_subscriptions": [
                    {
                        "subscription": { "id": 9 },
                        "amount_total": 500000,
                        "amount_used": 500000
                    }
                ]
            }
        }"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let result = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(result.success);
        assert_eq!(result.remaining, Some(0.0));
        assert_eq!(result.plan_name.as_deref(), Some("default"));
    }

    #[test]
    fn subscription_no_valid_items_is_failure() {
        let body = r#"{
            "success": true,
            "data": { "subscriptions": [] }
        }"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let result = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(!result.success);
    }

    #[test]
    fn subscription_missing_data_is_failure() {
        let body = r#"{"success":false,"message":"server busy"}"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let result = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(!result.success);
        assert_eq!(result.message.as_deref(), Some("server busy"));
    }
}
