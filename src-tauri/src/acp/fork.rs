//! ACP `session/fork` support via raw JSON-RPC messages.
//!
//! The `sacp` crate does not yet provide typed request/response types for
//! `session/fork`, so we use `UntypedMessage` (the same pattern used for
//! `session/set_config_option` in connection.rs).

use sacp::schema::{ForkSessionRequest, ForkSessionResponse, SessionId};
use sacp::{Agent, ConnectionTo, UntypedMessage};

use crate::acp::error::AcpError;

pub(crate) fn build_fork_session_request(
    session_id: &SessionId,
    cwd: &str,
    meta: Option<serde_json::Map<String, serde_json::Value>>,
) -> ForkSessionRequest {
    let mut request = ForkSessionRequest::new(session_id.clone(), cwd);
    if let Some(meta) = meta {
        request = request.meta(meta);
    }
    request
}

/// Send a `session/fork` request over an existing ACP connection.
///
/// Returns the full `ForkSessionResponse` so the caller can attach directly
/// without a separate `session/load` round-trip, plus the raw top-level `models`
/// value (captured before the typed deserialize drops it) so the Grok path can
/// parse per-model reasoning-effort data. `None` when the response has no
/// `models` field.
pub async fn fork_session(
    cx: &ConnectionTo<Agent>,
    session_id: &SessionId,
    cwd: &str,
    meta: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<(ForkSessionResponse, Option<serde_json::Value>), AcpError> {
    let request = build_fork_session_request(session_id, cwd, meta);
    let untyped_req = UntypedMessage::new("session/fork", &request)
        .map_err(|e| AcpError::protocol(format!("Failed to build fork request: {e}")))?;

    let raw_response: serde_json::Value = cx
        .send_request_to(Agent, untyped_req)
        .block_task()
        .await
        .map_err(|e| AcpError::protocol(format!("session/fork failed: {e}")))?;

    let models = raw_response.get("models").cloned();
    let response: ForkSessionResponse = serde_json::from_value(raw_response)
        .map_err(|e| AcpError::protocol(format!("Failed to parse fork response: {e}")))?;

    Ok((response, models))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fork_request_preserves_claude_session_meta() {
        let meta = serde_json::json!({
            "claudeCode": {
                "options": {
                    "settings": { "autoCompactWindow": 300000 }
                }
            }
        })
        .as_object()
        .cloned();
        let request = build_fork_session_request(
            &SessionId::new("source-session".to_string()),
            "/tmp/codeg",
            meta,
        );
        let json = serde_json::to_value(request).expect("serialize fork request");

        assert_eq!(
            json.pointer("/_meta/claudeCode/options/settings/autoCompactWindow"),
            Some(&serde_json::json!(300000))
        );
    }
}
