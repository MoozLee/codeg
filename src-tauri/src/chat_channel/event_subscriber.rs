use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sea_orm::DatabaseConnection;
use tokio::task::JoinHandle;

use super::i18n::Lang;
use super::manager::ChatChannelManager;
use super::message_formatter;
use super::types::RichMessage;
use crate::acp::internal_bus::InternalEventBus;
use crate::acp::types::AcpEvent;
use crate::db::service::{
    app_metadata_service, chat_channel_message_log_service, chat_channel_service,
};

/// Minimum interval between pushes for the same event type per channel (debounce).
const DEBOUNCE_SECS: u64 = 5;
/// How often to refresh cached config from DB.
const CONFIG_CACHE_TTL_SECS: u64 = 30;

const MESSAGE_LANGUAGE_KEY: &str = "chat_message_language";
const EVENT_FILTER_KEY: &str = "chat_event_filter";

struct CachedChannel {
    id: i32,
    event_filter_json: Option<String>,
}

struct EventConfigCache {
    lang: Lang,
    global_filter: Option<Vec<String>>,
    enabled_channels: Vec<CachedChannel>,
    last_refresh: Instant,
}

impl EventConfigCache {
    fn new() -> Self {
        Self {
            lang: Lang::default(),
            global_filter: None,
            enabled_channels: Vec::new(),
            // Force refresh on first use
            last_refresh: Instant::now() - Duration::from_secs(CONFIG_CACHE_TTL_SECS + 1),
        }
    }

    async fn refresh_if_needed(&mut self, db: &DatabaseConnection) {
        if self.last_refresh.elapsed() < Duration::from_secs(CONFIG_CACHE_TTL_SECS) {
            return;
        }

        if let Ok(Some(val)) = app_metadata_service::get_value(db, MESSAGE_LANGUAGE_KEY).await {
            self.lang = Lang::from_str_lossy(&val);
        }

        // Parse as Option<Vec<String>> so JSON "null" → None (intentional, not accidental)
        self.global_filter = app_metadata_service::get_value(db, EVENT_FILTER_KEY)
            .await
            .ok()
            .flatten()
            .and_then(|json| {
                serde_json::from_str::<Option<Vec<String>>>(&json)
                    .ok()
                    .flatten()
            });

        if let Ok(channels) = chat_channel_service::list_enabled(db).await {
            self.enabled_channels = channels
                .into_iter()
                .map(|ch| CachedChannel {
                    id: ch.id,
                    event_filter_json: ch.event_filter_json,
                })
                .collect();
        }

        self.last_refresh = Instant::now();
    }
}

pub fn spawn_event_subscriber(
    bus: Arc<InternalEventBus>,
    manager: ChatChannelManager,
    db_conn: DatabaseConnection,
) -> JoinHandle<()> {
    // Subscribe synchronously before the spawn so the broadcast buffer
    // catches any events emitted in the gap between `start_background`
    // returning and the spawned task's first `rx.recv().await` poll.
    let mut rx = bus.subscribe();
    let metrics = Arc::clone(bus.metrics());

    tokio::spawn(async move {
        let mut last_push: HashMap<(i32, String), Instant> = HashMap::new();
        let mut config = EventConfigCache::new();

        loop {
            let envelope_arc = match rx.recv().await {
                Ok(e) => e,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    eprintln!("[ChatChannel] event subscriber lagged by {n} messages");
                    metrics.lagged_count.fetch_add(n, Ordering::Relaxed);
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    eprintln!("[ChatChannel] internal bus closed, stopping subscriber");
                    break;
                }
            };

            config.refresh_if_needed(&db_conn).await;

            // Prune stale debounce entries
            last_push.retain(|_, t| t.elapsed() < Duration::from_secs(DEBOUNCE_SECS * 2));

            if let Some((event_type, msg)) = parse_acp_event(&envelope_arc.payload, config.lang) {
                // Global event filter check
                if let Some(filter) = &config.global_filter {
                    if !filter.contains(&event_type) {
                        continue;
                    }
                }

                for ch in &config.enabled_channels {
                    // Per-channel event filter
                    if let Some(filter_json) = &ch.event_filter_json {
                        if let Ok(filter) = serde_json::from_str::<Vec<String>>(filter_json) {
                            if !filter.contains(&event_type) {
                                continue;
                            }
                        }
                    }

                    // Debounce: skip if same event type was pushed to this channel recently
                    let key = (ch.id, event_type.clone());
                    let now = Instant::now();
                    if let Some(last) = last_push.get(&key) {
                        if now.duration_since(*last) < Duration::from_secs(DEBOUNCE_SECS) {
                            continue;
                        }
                    }

                    // Send
                    let send_result = manager.send_to_channel(ch.id, &msg).await;
                    let (status, error_detail) = match &send_result {
                        Ok(_) => {
                            // Only update debounce timestamp on success
                            last_push.insert(key, now);
                            ("sent", None)
                        }
                        Err(e) => ("failed", Some(e.to_string())),
                    };

                    let _ = chat_channel_message_log_service::create_log(
                        &db_conn,
                        ch.id,
                        "outbound",
                        "event_push",
                        &msg.to_plain_text(),
                        status,
                        error_detail,
                    )
                    .await;
                }
            }
        }
    })
}

/// Map an ACP event into the chat-channel push tuple. Pattern-match on the
/// typed `AcpEvent` variant — Phase 5 source-of-truth replaces the prior
/// JSON `type`-string dispatch (which paid `serde_json::from_value` per
/// event for the global broadcaster path).
fn parse_acp_event(payload: &AcpEvent, lang: Lang) -> Option<(String, RichMessage)> {
    match payload {
        AcpEvent::TurnComplete {
            stop_reason,
            agent_type,
            ..
        } => {
            // Only push for end_turn, not for intermediate completions.
            if stop_reason != "end_turn" {
                return None;
            }
            Some((
                "turn_complete".to_string(),
                message_formatter::format_turn_complete(agent_type, stop_reason, lang),
            ))
        }
        AcpEvent::Error {
            message,
            agent_type,
            ..
        } => Some((
            "error".to_string(),
            message_formatter::format_agent_error(agent_type, message, lang),
        )),
        _ => None,
    }
}
