//! NewAPI (cc-switch style) balance + subscription query helpers.
//!
//! Every error path returns a populated `ProviderUsageResult` (or nested
//! `ProviderUsageAmount`) with `success = false` — we never surface an
//! `AppCommandError` here. The frontend renders failed queries as tooltip
//! text in the status bar and a red badge in the settings list; throwing a
//! generic command error would replace that with an unhelpful toast.
//!
//! Documentation references (`.trellis/tasks/.../research/newapi-balance-subscription.md`):
//!
//! - Balance: `GET {base_url}/api/user/self` → `data.quota`, `data.used_quota`,
//!   `data.group`. All quota values divide by `500_000` to convert to USD.
//! - Subscription: `GET {base_url}/api/subscription/self` →
//!   `data.subscriptions` for visible package details. Aggregates use
//!   `data.subscriptions`, with `data.all_subscriptions` only as a compatibility
//!   fallback when `subscriptions` is empty. Each item with a non-null
//!   `subscription` contributes `amount_total` / `amount_used` (or the
//!   `total_amount` / `used_amount` / `quota` / `used_quota` alternates some
//!   NewAPI deployments use).

use std::time::Duration;

use chrono::Utc;
use serde::Deserialize;

use crate::models::provider_usage::{
    ProviderUsageAmount, ProviderUsageResult, ProviderUsageSubscriptionItem, QueryKind,
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

/// Run each requested kind and aggregate the outcomes into a single
/// `ProviderUsageResult`. When the caller asked for both balance and
/// subscription the top-level totals are the sum of each kind's USD values;
/// with only one kind the result mirrors that kind's amounts directly.
pub async fn execute_kinds(
    config_id: i32,
    kinds: &[QueryKind],
    base_url: &str,
    user_id: &str,
    token: &str,
    timeout_seconds: u64,
) -> ProviderUsageResult {
    let mut balance_amount: Option<ProviderUsageAmount> = None;
    let mut subscription_amount: Option<ProviderUsageAmount> = None;

    for kind in kinds {
        let cfg = ExecConfig {
            config_id,
            query_kind: *kind,
            base_url: base_url.to_string(),
            user_id: user_id.to_string(),
            token: token.to_string(),
            timeout_seconds: timeout_seconds.max(1),
        };
        let amount = match kind {
            QueryKind::NewapiBalance => query_newapi_balance_amount(&cfg).await,
            QueryKind::NewapiSubscription => query_newapi_subscription_amount(&cfg).await,
        };
        match kind {
            QueryKind::NewapiBalance => balance_amount = Some(amount),
            QueryKind::NewapiSubscription => subscription_amount = Some(amount),
        }
    }

    aggregate_result(config_id, kinds, balance_amount, subscription_amount)
}

fn aggregate_result(
    config_id: i32,
    kinds: &[QueryKind],
    balance: Option<ProviderUsageAmount>,
    subscription: Option<ProviderUsageAmount>,
) -> ProviderUsageResult {
    let query_kind_label = kinds
        .iter()
        .map(|k| k.as_str())
        .collect::<Vec<_>>()
        .join(",");

    let successes: Vec<&ProviderUsageAmount> = [balance.as_ref(), subscription.as_ref()]
        .into_iter()
        .flatten()
        .filter(|a| a.success)
        .collect();

    if successes.is_empty() {
        let message = balance
            .as_ref()
            .and_then(|a| a.message.clone())
            .or_else(|| subscription.as_ref().and_then(|a| a.message.clone()))
            .unwrap_or_else(|| "Query failed".to_string());
        return ProviderUsageResult {
            config_id,
            query_kind: query_kind_label,
            success: false,
            plan_name: None,
            used: None,
            remaining: None,
            total: None,
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            updated_at: now_rfc3339(),
            expires_at: None,
            message: Some(message),
            balance,
            subscription,
        };
    }

    // Aggregate top-level totals. Presence rule: if any successful kind
    // provides a value, include it in the sum; if none provides it, the
    // aggregate stays `None` (so "no total known" doesn't collapse to 0).
    let used = sum_optional(successes.iter().map(|a| &a.used)).map(clamp_zero);
    let remaining = sum_optional(successes.iter().map(|a| &a.remaining)).map(clamp_zero);
    let total = sum_optional(successes.iter().map(|a| &a.total)).map(clamp_zero);

    let plan_name_parts: Vec<String> = successes
        .iter()
        .filter_map(|a| a.plan_name.as_ref())
        .filter(|s| !s.is_empty())
        .cloned()
        .collect();
    let plan_name = if plan_name_parts.is_empty() {
        None
    } else {
        Some(plan_name_parts.join(" + "))
    };

    let subscriptions = subscription.as_ref().and_then(|a| a.subscriptions.clone());

    let expires_at = successes
        .iter()
        .filter_map(|a| a.expires_at.clone())
        .next_back();

    ProviderUsageResult {
        config_id,
        query_kind: query_kind_label,
        success: true,
        plan_name,
        used,
        remaining,
        total,
        unit: UNIT_USD.to_string(),
        subscriptions,
        updated_at: now_rfc3339(),
        expires_at,
        message: None,
        balance,
        subscription,
    }
}

fn sum_optional<'a, I>(values: I) -> Option<f64>
where
    I: IntoIterator<Item = &'a Option<f64>>,
{
    let mut sum = 0.0_f64;
    let mut any = false;
    for v in values.into_iter().flatten() {
        sum += v;
        any = true;
    }
    if any {
        Some(sum)
    } else {
        None
    }
}

/// Floating-point dust around zero is a UX problem more than a math problem.
/// Per-kind `remaining` is already clamped to `>= 0` in
/// `clamp_remaining_non_negative` before reaching the aggregator, so the
/// summed totals here are non-negative for `remaining`. This `clamp_zero`
/// stays as a final defensive pass: a sum of two `0.0` floats can still land
/// inside the (-0.005, 0.005) dust band on degenerate inputs, and we'd
/// rather show "0.00" than "-0.00". Real upstream negatives outside that
/// band remain untouched.
fn clamp_zero(value: f64) -> f64 {
    if value.abs() < 0.005 {
        0.0
    } else {
        value
    }
}

pub async fn query_newapi_balance_amount(cfg: &ExecConfig) -> ProviderUsageAmount {
    let amount = execute_query(cfg, "/api/user/self", parse_balance_body).await;
    clamp_remaining_non_negative(amount)
}

pub async fn query_newapi_subscription_amount(cfg: &ExecConfig) -> ProviderUsageAmount {
    let amount = execute_query(cfg, "/api/subscription/self", parse_subscription_body).await;
    clamp_remaining_non_negative(amount)
}

/// Display-semantic clamp: small negative `remaining` values (e.g. NewAPI
/// returning -0.02 USD because of upstream rounding) render as a confusing
/// red negative balance, but the user's intent is "≥ 0". Clamp the per-kind
/// `remaining` and each subscription item's `remaining` to a non-negative
/// floor before aggregation; `used` and `total` keep their raw values so the
/// popover detail still reflects upstream truth.
fn clamp_remaining_non_negative(mut amount: ProviderUsageAmount) -> ProviderUsageAmount {
    if let Some(r) = amount.remaining {
        if r < 0.0 {
            amount.remaining = Some(0.0);
        }
    }
    if let Some(items) = amount.subscriptions.as_mut() {
        for item in items.iter_mut() {
            if let Some(r) = item.remaining {
                if r < 0.0 {
                    item.remaining = Some(0.0);
                }
            }
        }
    }
    amount
}

/// Shared request/response pipeline. `parse` receives the raw JSON value of
/// the top-level response and the API's `success`/`message` fields so it can
/// emit per-query-kind semantics without duplicating HTTP plumbing.
async fn execute_query<F>(cfg: &ExecConfig, path: &str, parse: F) -> ProviderUsageAmount
where
    F: FnOnce(&ExecConfig, NewApiEnvelope) -> ProviderUsageAmount,
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

fn parse_balance_body(cfg: &ExecConfig, env: NewApiEnvelope) -> ProviderUsageAmount {
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
        (Some(q), Some(u)) => (
            Some(q / USD_DIVISOR),
            Some(u / USD_DIVISOR),
            Some((q + u) / USD_DIVISOR),
        ),
        (Some(q), None) => (Some(q / USD_DIVISOR), None, Some(q / USD_DIVISOR)),
        (None, Some(u)) => (None, Some(u / USD_DIVISOR), None),
        (None, None) => (None, None, None),
    };

    ProviderUsageAmount {
        success: true,
        query_kind: cfg.query_kind.as_str().to_string(),
        plan_name: group,
        used,
        remaining,
        total,
        unit: UNIT_USD.to_string(),
        subscriptions: None,
        expires_at: None,
        message: None,
    }
}

/// Best-effort numeric extraction from a possibly-number-or-string JSON value.
/// NewAPI Go deployments sometimes stringify large quota integers, so we fall
/// back to `str::parse::<f64>` before giving up.
fn number_from_any(v: &serde_json::Value) -> Option<f64> {
    if let Some(n) = number_from_value(v) {
        return Some(n);
    }
    if let Some(s) = v.as_str() {
        if let Ok(n) = s.trim().parse::<f64>() {
            return Some(n);
        }
    }
    None
}

/// Resolve a plan title from any of the known field locations:
/// `item.plan_title`, `item.subscription.plan_title`, or
/// `item.subscription.name`.
fn extract_plan_title(item: &serde_json::Value) -> Option<String> {
    let mut candidates: Vec<Option<&str>> = Vec::with_capacity(3);
    candidates.push(item.get("plan_title").and_then(|v| v.as_str()));
    if let Some(sub) = item.get("subscription") {
        candidates.push(sub.get("plan_title").and_then(|v| v.as_str()));
        candidates.push(sub.get("name").and_then(|v| v.as_str()));
    }
    candidates
        .into_iter()
        .flatten()
        .find(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Resolve total / used amounts for a subscription item, tolerating the three
/// common NewAPI payload shapes:
/// - `amount_total` / `amount_used` (classic)
/// - `total_amount` / `used_amount`
/// - `quota` / `used_quota` (some deployments reuse the balance vocabulary)
///
/// Each field may be a number or a stringified number.
fn extract_amounts(item: &serde_json::Value) -> (f64, f64) {
    let subscription = item.get("subscription").filter(|v| !v.is_null());
    let total = item
        .get("amount_total")
        .and_then(number_from_any)
        .or_else(|| subscription.and_then(|sub| sub.get("amount_total").and_then(number_from_any)))
        .or_else(|| item.get("total_amount").and_then(number_from_any))
        .or_else(|| subscription.and_then(|sub| sub.get("total_amount").and_then(number_from_any)))
        .or_else(|| item.get("quota").and_then(number_from_any))
        .or_else(|| subscription.and_then(|sub| sub.get("quota").and_then(number_from_any)))
        .unwrap_or(0.0);
    let used = item
        .get("amount_used")
        .and_then(number_from_any)
        .or_else(|| subscription.and_then(|sub| sub.get("amount_used").and_then(number_from_any)))
        .or_else(|| item.get("used_amount").and_then(number_from_any))
        .or_else(|| subscription.and_then(|sub| sub.get("used_amount").and_then(number_from_any)))
        .or_else(|| item.get("used_quota").and_then(number_from_any))
        .or_else(|| subscription.and_then(|sub| sub.get("used_quota").and_then(number_from_any)))
        .unwrap_or(0.0);
    (total, used)
}

fn item_end_time(item: &serde_json::Value) -> Option<f64> {
    let subscription = item.get("subscription").filter(|v| !v.is_null());
    item.get("end_time")
        .and_then(number_from_any)
        .or_else(|| subscription.and_then(|sub| sub.get("end_time").and_then(number_from_any)))
}

fn parse_subscription_body(cfg: &ExecConfig, env: NewApiEnvelope) -> ProviderUsageAmount {
    let data = env.data.clone();

    let mut visible_subs: Vec<serde_json::Value> = Vec::new();
    if let Some(d) = data.as_ref() {
        if let Some(items) = d.get("subscriptions").and_then(|v| v.as_array()) {
            visible_subs.extend(items.iter().cloned());
        }
    }

    let visible_valid: Vec<&serde_json::Value> = visible_subs
        .iter()
        .filter(|item| item.get("subscription").is_some_and(|v| !v.is_null()))
        .collect();

    let mut fallback_subs: Vec<serde_json::Value> = Vec::new();
    if visible_valid.is_empty() {
        if let Some(d) = data.as_ref() {
            if let Some(items) = d.get("all_subscriptions").and_then(|v| v.as_array()) {
                fallback_subs.extend(items.iter().cloned());
            }
        }
    }

    let aggregate_valid: Vec<&serde_json::Value> = if visible_valid.is_empty() {
        fallback_subs
            .iter()
            .filter(|item| item.get("subscription").is_some_and(|v| !v.is_null()))
            .collect()
    } else {
        visible_valid.clone()
    };

    if env.success != Some(true) || aggregate_valid.is_empty() {
        let msg = env
            .message
            .clone()
            .unwrap_or_else(|| "Query failed".to_string());
        return failure(cfg, &msg);
    }

    let mut total_amount = 0.0_f64;
    let mut used_amount = 0.0_f64;
    let mut plan_titles: Vec<String> = Vec::new();
    let mut latest_end_time: Option<i64> = None;

    for item in &aggregate_valid {
        let (amount_total, amount_used) = extract_amounts(item);
        total_amount += amount_total;
        used_amount += amount_used;

        let plan_title = extract_plan_title(item);
        if let Some(title) = plan_title {
            if !title.is_empty() {
                plan_titles.push(title);
            }
        }

        let end_time = item_end_time(item);
        if let Some(end_ts) = end_time {
            let end_ts_i = end_ts as i64;
            latest_end_time = Some(match latest_end_time {
                Some(existing) => existing.max(end_ts_i),
                None => end_ts_i,
            });
        }
    }

    let mut items: Vec<ProviderUsageSubscriptionItem> = Vec::new();
    for item in &visible_valid {
        let (amount_total, amount_used) = extract_amounts(item);
        let plan_title = extract_plan_title(item);
        let item_total_usd = amount_total / USD_DIVISOR;
        let item_used_usd = amount_used / USD_DIVISOR;
        let item_remaining_usd = (amount_total - amount_used) / USD_DIVISOR;
        let expires_at = item_end_time(item).and_then(|ts| epoch_to_rfc3339(ts as i64));

        items.push(ProviderUsageSubscriptionItem {
            plan_name: plan_title.unwrap_or_else(|| "default".to_string()),
            used: Some(item_used_usd),
            remaining: Some(item_remaining_usd),
            total: Some(item_total_usd),
            expires_at,
        });
    }

    // Guard against deployments that return valid rows with zeroed amounts —
    // showing "0 / 0 USD" in the status bar is actively misleading, so surface
    // it as a failure case with a diagnostic message instead.
    if total_amount == 0.0 && used_amount == 0.0 {
        return failure(cfg, "empty subscription amounts");
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

    ProviderUsageAmount {
        success: true,
        query_kind: cfg.query_kind.as_str().to_string(),
        plan_name: Some(plan_name),
        used: Some(used_usd),
        remaining: Some(remaining_usd),
        total: Some(total_usd),
        unit: UNIT_USD.to_string(),
        subscriptions: if items.is_empty() { None } else { Some(items) },
        expires_at,
        message: None,
    }
}

fn failure(cfg: &ExecConfig, message: &str) -> ProviderUsageAmount {
    ProviderUsageAmount {
        success: false,
        query_kind: cfg.query_kind.as_str().to_string(),
        plan_name: None,
        used: None,
        remaining: None,
        total: None,
        unit: UNIT_USD.to_string(),
        subscriptions: None,
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
        let amount = parse_balance_body(&cfg(QueryKind::NewapiBalance), env);
        assert!(amount.success);
        assert_eq!(amount.plan_name.as_deref(), Some("vip"));
        assert_eq!(amount.remaining, Some(1.0));
        assert_eq!(amount.used, Some(0.5));
        assert_eq!(amount.total, Some(1.5));
        assert_eq!(amount.unit, "USD");
    }

    #[test]
    fn balance_failure_propagates_message() {
        let env: NewApiEnvelope =
            serde_json::from_str(r#"{"success":false,"message":"bad token"}"#).unwrap();
        let amount = parse_balance_body(&cfg(QueryKind::NewapiBalance), env);
        assert!(!amount.success);
        assert_eq!(amount.message.as_deref(), Some("bad token"));
    }

    #[test]
    fn balance_missing_data_is_failure() {
        let env: NewApiEnvelope = serde_json::from_str(r#"{"success":true}"#).unwrap();
        let amount = parse_balance_body(&cfg(QueryKind::NewapiBalance), env);
        assert!(!amount.success);
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
        let amount = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(amount.success);
        assert_eq!(amount.plan_name.as_deref(), Some("Gold + Silver"));
        assert_eq!(amount.total, Some(3.0));
        assert_eq!(amount.used, Some(0.7));
        assert_eq!(amount.remaining, Some(2.3));
        let items = amount.subscriptions.as_ref().expect("items present");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].plan_name, "Gold");
        assert!(amount.expires_at.is_some());
    }

    #[test]
    fn subscription_reads_all_subscriptions_aggregate_without_visible_items() {
        let body = r#"{
            "success": true,
            "data": {
                "subscriptions": [],
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
        let amount = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        // amount_total > 0 and amount_used > 0 → valid aggregate.
        assert!(amount.success);
        assert_eq!(amount.remaining, Some(0.0));
        assert_eq!(amount.total, Some(1.0));
        assert_eq!(amount.used, Some(1.0));
        assert_eq!(amount.plan_name.as_deref(), Some("default"));
        assert!(amount.subscriptions.is_none());
    }

    #[test]
    fn subscription_accepts_nested_amount_total_and_used() {
        // Real NewAPI payload captured from user report: `amount_total` /
        // `amount_used` live under the nested `subscription` object, while
        // `plan_title` lives on the outer item.
        let body = r#"{
            "success": true,
            "data": {
                "subscriptions": [
                    {
                        "subscription": {
                            "id": 1,
                            "amount_total": 1500000000,
                            "amount_used": 250000000,
                            "end_time": 1900000000,
                            "status": "active"
                        },
                        "plan_title": "[PRO月池] CodeG 月卡 3000$"
                    }
                ],
                "billing_preference": "subscription_only"
            }
        }"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let amount = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(amount.success, "expected success, got {:?}", amount.message);
        assert_eq!(amount.total, Some(3000.0));
        assert_eq!(amount.used, Some(500.0));
        assert_eq!(amount.remaining, Some(2500.0));
        assert_eq!(
            amount.plan_name.as_deref(),
            Some("[PRO月池] CodeG 月卡 3000$")
        );
        let items = amount.subscriptions.as_ref().expect("items present");
        assert_eq!(items[0].total, Some(3000.0));
        assert_eq!(items[0].used, Some(500.0));
        assert_eq!(items[0].remaining, Some(2500.0));
        assert!(items[0].expires_at.is_some());
    }

    #[test]
    fn subscription_accepts_total_used_amount_alias() {
        // Real NewAPI payload alias: `total_amount` / `used_amount` with a
        // nested `subscription.plan_title`.
        let body = r#"{
            "success": true,
            "data": {
                "subscriptions": [
                    {
                        "subscription": { "id": 1, "plan_title": "Pro" },
                        "total_amount": 2000000,
                        "used_amount": 500000,
                        "end_time": 1900000000
                    }
                ]
            }
        }"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let amount = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(amount.success, "expected success, got {:?}", amount.message);
        assert_eq!(amount.total, Some(4.0));
        assert_eq!(amount.used, Some(1.0));
        assert_eq!(amount.remaining, Some(3.0));
        assert_eq!(amount.plan_name.as_deref(), Some("Pro"));
    }

    #[test]
    fn subscription_accepts_quota_alias_with_string_numbers() {
        // NewAPI Go deployments occasionally reuse the balance vocabulary
        // (`quota` / `used_quota`) and stringify large integers.
        let body = r#"{
            "success": true,
            "data": {
                "all_subscriptions": [
                    {
                        "subscription": { "id": 2, "name": "Team" },
                        "quota": "1500000",
                        "used_quota": "500000"
                    }
                ]
            }
        }"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let amount = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(amount.success);
        assert_eq!(amount.total, Some(3.0));
        assert_eq!(amount.used, Some(1.0));
        assert_eq!(amount.remaining, Some(2.0));
        assert_eq!(amount.plan_name.as_deref(), Some("Team"));
        assert!(amount.subscriptions.is_none());
    }

    #[test]
    fn subscription_no_valid_items_is_failure() {
        let body = r#"{
            "success": true,
            "data": { "subscriptions": [] }
        }"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let amount = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(!amount.success);
    }

    #[test]
    fn subscription_zero_amounts_is_failure() {
        let body = r#"{
            "success": true,
            "data": {
                "subscriptions": [
                    {
                        "subscription": { "id": 1 },
                        "amount_total": 0,
                        "amount_used": 0,
                        "plan_title": "Zero"
                    }
                ]
            }
        }"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let amount = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(!amount.success);
        assert_eq!(
            amount.message.as_deref(),
            Some("empty subscription amounts")
        );
    }

    #[test]
    fn subscription_missing_data_is_failure() {
        let body = r#"{"success":false,"message":"server busy"}"#;
        let env: NewApiEnvelope = serde_json::from_str(body).unwrap();
        let amount = parse_subscription_body(&cfg(QueryKind::NewapiSubscription), env);
        assert!(!amount.success);
        assert_eq!(amount.message.as_deref(), Some("server busy"));
    }

    #[test]
    fn aggregate_combines_balance_and_subscription() {
        let balance = ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiBalance.as_str().to_string(),
            plan_name: Some("vip".to_string()),
            used: Some(0.5),
            remaining: Some(1.0),
            total: Some(1.5),
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: None,
        };
        let subscription = ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiSubscription.as_str().to_string(),
            plan_name: Some("Pro".to_string()),
            used: Some(1.0),
            remaining: Some(3.0),
            total: Some(4.0),
            unit: UNIT_USD.to_string(),
            subscriptions: Some(vec![ProviderUsageSubscriptionItem {
                plan_name: "Pro".to_string(),
                used: Some(1.0),
                remaining: Some(3.0),
                total: Some(4.0),
                expires_at: None,
            }]),
            expires_at: Some("2030-01-01T00:00:00+00:00".to_string()),
            message: None,
        };
        let result = aggregate_result(
            1,
            &[QueryKind::NewapiBalance, QueryKind::NewapiSubscription],
            Some(balance),
            Some(subscription),
        );
        assert!(result.success);
        assert_eq!(result.used, Some(1.5));
        assert_eq!(result.total, Some(5.5));
        assert_eq!(result.remaining, Some(4.0));
        assert_eq!(result.plan_name.as_deref(), Some("vip + Pro"));
        assert_eq!(result.query_kind, "newapi_balance,newapi_subscription");
        // Per-kind slices stay populated so the popover can render
        // separate "Balance" and "Subscription" sections without the UI
        // re-deriving anything from the top-level totals.
        let balance_slice = result.balance.as_ref().expect("balance slice");
        assert!(balance_slice.success);
        assert_eq!(balance_slice.used, Some(0.5));
        assert_eq!(balance_slice.total, Some(1.5));
        let subscription_slice = result.subscription.as_ref().expect("subscription slice");
        assert!(subscription_slice.success);
        assert_eq!(subscription_slice.used, Some(1.0));
        assert_eq!(subscription_slice.total, Some(4.0));
        assert!(result.subscriptions.is_some());
    }

    #[test]
    fn aggregate_single_kind_passes_through() {
        let balance = ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiBalance.as_str().to_string(),
            plan_name: Some("vip".to_string()),
            used: Some(0.5),
            remaining: Some(1.0),
            total: Some(1.5),
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: None,
        };
        let result = aggregate_result(7, &[QueryKind::NewapiBalance], Some(balance), None);
        assert!(result.success);
        assert_eq!(result.used, Some(0.5));
        assert_eq!(result.total, Some(1.5));
        assert_eq!(result.remaining, Some(1.0));
        assert_eq!(result.plan_name.as_deref(), Some("vip"));
        assert_eq!(result.query_kind, "newapi_balance");
        assert!(result.subscription.is_none());
    }

    #[test]
    fn aggregate_clamps_floating_point_dust_around_zero() {
        // Sum of the per-kind remaining values lands inside the
        // (-0.005, 0.005) dust band, where the user shouldn't see a
        // confusing red negative balance for what's effectively zero.
        let balance = ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiBalance.as_str().to_string(),
            plan_name: Some("default".to_string()),
            used: Some(7380.55),
            remaining: Some(0.0),
            total: Some(7380.55),
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: None,
        };
        let subscription = ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiSubscription.as_str().to_string(),
            plan_name: Some("Pro".to_string()),
            used: Some(0.001),
            remaining: Some(-0.001),
            total: Some(0.0),
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: None,
        };
        let result = aggregate_result(
            1,
            &[QueryKind::NewapiBalance, QueryKind::NewapiSubscription],
            Some(balance),
            Some(subscription),
        );
        assert!(result.success);
        assert_eq!(result.remaining, Some(0.0));
        // Per-kind slices preserve the raw upstream values so the popover
        // can show the unaggregated detail; the dust clamp only applies to
        // the displayed aggregate.
        let sub_amount = result.subscription.as_ref().expect("subscription slice");
        assert_eq!(sub_amount.remaining, Some(-0.001));
    }

    #[test]
    fn aggregate_preserves_real_negatives_outside_dust_band() {
        // Aggregator-isolation test: the aggregator only applies a defensive
        // dust clamp (|x| < 0.005). Real upstream negatives outside that band
        // would survive aggregation if they ever reached it. In production
        // this case no longer occurs because per-kind `remaining` is clamped
        // to ≥ 0 in `clamp_remaining_non_negative` before aggregation; this
        // test pins the aggregator-only contract for direct callers.
        let balance = ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiBalance.as_str().to_string(),
            plan_name: None,
            used: Some(7380.55),
            remaining: Some(0.0),
            total: Some(7380.55),
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: None,
        };
        let subscription = ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiSubscription.as_str().to_string(),
            plan_name: None,
            used: Some(0.02),
            remaining: Some(-0.02),
            total: Some(0.0),
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: None,
        };
        let result = aggregate_result(
            1,
            &[QueryKind::NewapiBalance, QueryKind::NewapiSubscription],
            Some(balance),
            Some(subscription),
        );
        assert_eq!(result.remaining, Some(-0.02));
    }

    #[test]
    fn aggregate_all_failures_is_failure() {
        let balance = ProviderUsageAmount {
            success: false,
            query_kind: QueryKind::NewapiBalance.as_str().to_string(),
            plan_name: None,
            used: None,
            remaining: None,
            total: None,
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: Some("bad token".to_string()),
        };
        let subscription = ProviderUsageAmount {
            success: false,
            query_kind: QueryKind::NewapiSubscription.as_str().to_string(),
            plan_name: None,
            used: None,
            remaining: None,
            total: None,
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: Some("empty subscription amounts".to_string()),
        };
        let result = aggregate_result(
            1,
            &[QueryKind::NewapiBalance, QueryKind::NewapiSubscription],
            Some(balance),
            Some(subscription),
        );
        assert!(!result.success);
        assert_eq!(result.message.as_deref(), Some("bad token"));
    }

    #[test]
    fn per_kind_clamp_pins_balance_remaining_to_zero() {
        let amount = ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiBalance.as_str().to_string(),
            plan_name: Some("default".to_string()),
            used: Some(7380.55),
            remaining: Some(-0.02),
            total: Some(7380.55),
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: None,
        };
        let clamped = clamp_remaining_non_negative(amount);
        assert_eq!(clamped.remaining, Some(0.0));
        // `used` and `total` must keep their raw upstream values.
        assert_eq!(clamped.used, Some(7380.55));
        assert_eq!(clamped.total, Some(7380.55));
    }

    #[test]
    fn per_kind_clamp_pins_subscription_remaining_and_items() {
        let amount = ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiSubscription.as_str().to_string(),
            plan_name: Some("Pro".to_string()),
            used: Some(0.02),
            remaining: Some(-0.02),
            total: Some(0.0),
            unit: UNIT_USD.to_string(),
            subscriptions: Some(vec![
                ProviderUsageSubscriptionItem {
                    plan_name: "Pro".to_string(),
                    used: Some(0.02),
                    remaining: Some(-0.02),
                    total: Some(0.0),
                    expires_at: None,
                },
                ProviderUsageSubscriptionItem {
                    plan_name: "Team".to_string(),
                    used: Some(1.0),
                    remaining: Some(2.0),
                    total: Some(3.0),
                    expires_at: None,
                },
            ]),
            expires_at: None,
            message: None,
        };
        let clamped = clamp_remaining_non_negative(amount);
        assert_eq!(clamped.remaining, Some(0.0));
        let items = clamped.subscriptions.expect("items present");
        assert_eq!(items[0].remaining, Some(0.0));
        // Already-positive items must not change.
        assert_eq!(items[1].remaining, Some(2.0));
    }

    #[test]
    fn per_kind_clamp_keeps_aggregate_remaining_non_negative() {
        // End-to-end: balance and subscription each return the same shapes
        // they would in production, then go through `clamp_remaining_non_negative`
        // before aggregation. The aggregate `remaining` must be ≥ 0.
        let balance = clamp_remaining_non_negative(ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiBalance.as_str().to_string(),
            plan_name: Some("default".to_string()),
            used: Some(7380.55),
            remaining: Some(-0.02),
            total: Some(7380.55),
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: None,
        });
        let subscription = clamp_remaining_non_negative(ProviderUsageAmount {
            success: true,
            query_kind: QueryKind::NewapiSubscription.as_str().to_string(),
            plan_name: Some("Pro".to_string()),
            used: Some(0.02),
            remaining: Some(-0.02),
            total: Some(0.0),
            unit: UNIT_USD.to_string(),
            subscriptions: None,
            expires_at: None,
            message: None,
        });
        assert_eq!(balance.remaining, Some(0.0));
        assert_eq!(subscription.remaining, Some(0.0));
        let result = aggregate_result(
            1,
            &[QueryKind::NewapiBalance, QueryKind::NewapiSubscription],
            Some(balance),
            Some(subscription),
        );
        assert!(result.success);
        let remaining = result.remaining.expect("remaining present");
        assert!(remaining >= 0.0, "expected ≥ 0, got {remaining}");
    }
}
