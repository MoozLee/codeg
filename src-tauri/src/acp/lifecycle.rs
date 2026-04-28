//! Background subscriber that watches the global `acp://event` broadcaster
//! for events that need cross-connection DB persistence (e.g. binding the
//! agent's external session id onto a conversation row when SessionStarted
//! fires). Decoupled from `emit_with_state` so the emit hot path stays
//! lock-tight.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use sea_orm::DatabaseConnection;
use tokio::sync::broadcast;

use crate::acp::manager::ConnectionManager;
use crate::acp::types::{AcpEvent, EventEnvelope};
use crate::db::entities::conversation::ConversationStatus;
use crate::db::error::DbError;
use crate::db::service::conversation_service;
use crate::web::event_bridge::{emit_with_state, WebEvent, WebEventBroadcaster};

/// Backoff schedule for `handle_event` DB writes. Most transient
/// SQLite contention clears within the first retry; the third gives a
/// final chance before we fall back to "log loudly and move on".
const HANDLE_EVENT_RETRY_BACKOFFS: &[Duration] =
    &[Duration::from_millis(100), Duration::from_millis(500)];

/// Wrap `handle_event` with a small backoff retry. Most failures here
/// are transient SQLite "database is locked" errors that clear within a
/// few hundred milliseconds; without a retry the conversation row would
/// silently miss its `pending_review` write and the sidebar would stay
/// stuck on `in_progress` until the next prompt's `in_progress` write.
///
/// Final failure is logged at ERROR — this is the only signal the
/// subscriber is dropping correctness on the floor, so it must be noisy.
async fn handle_event_with_retry(
    db_conn: &DatabaseConnection,
    manager: &ConnectionManager,
    envelope: &EventEnvelope,
) {
    match handle_event(db_conn, manager, envelope).await {
        Ok(()) => return,
        Err(e) => {
            eprintln!(
                "[lifecycle][WARN] handle_event failed (attempt 1, will retry) for {:?}: {e}",
                envelope.payload
            );
        }
    }
    for (attempt, backoff) in HANDLE_EVENT_RETRY_BACKOFFS.iter().enumerate() {
        tokio::time::sleep(*backoff).await;
        match handle_event(db_conn, manager, envelope).await {
            Ok(()) => return,
            Err(e) => {
                let attempt_num = attempt + 2;
                let is_last = attempt + 1 == HANDLE_EVENT_RETRY_BACKOFFS.len();
                let level = if is_last { "ERROR" } else { "WARN" };
                eprintln!(
                    "[lifecycle][{level}] handle_event failed (attempt {attempt_num}{}) \
                     for {:?}: {e}",
                    if is_last { ", giving up" } else { ", will retry" },
                    envelope.payload
                );
            }
        }
    }
}

pub(crate) async fn handle_event(
    db_conn: &DatabaseConnection,
    manager: &ConnectionManager,
    envelope: &EventEnvelope,
) -> Result<(), DbError> {
    match &envelope.payload {
        AcpEvent::SessionStarted { session_id } => {
            // Look up conversation_id from the live state.
            let Some(state_arc) = manager.get_state(&envelope.connection_id).await else {
                return Ok(());
            };
            let conversation_id = state_arc.read().await.conversation_id;
            if let Some(cid) = conversation_id {
                conversation_service::update_external_id(db_conn, cid, session_id.clone())
                    .await?;
            }
            Ok(())
        }
        AcpEvent::TurnComplete { .. } => {
            // Centralized status transition: when the agent reports the turn
            // is done, flip the conversation row to PendingReview and
            // re-broadcast the change as `ConversationStatusChanged`. This
            // lives in the lifecycle subscriber (rather than at the original
            // emit site in `acp/connection.rs`) so the write is decoupled from
            // the protocol-event hot path AND survives a frontend refresh
            // mid-turn — the row gets the correct status even if no
            // browser is connected to react to TurnComplete itself.
            // `completed` / `cancelled` transitions remain frontend-driven.
            let Some((state_arc, emitter)) = manager
                .get_state_and_emitter(&envelope.connection_id)
                .await
            else {
                return Ok(());
            };
            let conversation_id = state_arc.read().await.conversation_id;
            // No conversation row bound (defensive — should never happen in
            // practice since `send_prompt_linked` runs before TurnComplete can
            // fire). Nothing to update.
            let Some(cid) = conversation_id else {
                return Ok(());
            };
            // DB write before emit so any downstream subscriber that observes
            // the ConversationStatusChanged event can assume the row is
            // already at PendingReview.
            conversation_service::update_status(db_conn, cid, ConversationStatus::PendingReview)
                .await?;
            emit_with_state(
                &state_arc,
                &emitter,
                AcpEvent::ConversationStatusChanged {
                    conversation_id: cid,
                    status: ConversationStatus::PendingReview,
                },
            )
            .await;
            Ok(())
        }
        // Other events don't need cross-connection DB persistence today; extend
        // this dispatcher with new arms as the lifecycle scope grows.
        _ => Ok(()),
    }
}

/// Subscribe to the broadcaster synchronously and return the subscriber loop
/// future. Caller spawns it onto whichever tokio runtime they manage
/// (`tokio::spawn` from inside an async context, `tauri::async_runtime::spawn`
/// from a Tauri `setup` callback that runs outside the runtime).
///
/// The `subscribe()` call happens here, before the future is returned, so any
/// events emitted between this call and the first poll are buffered by the
/// broadcast channel rather than dropped.
pub fn lifecycle_subscriber_task(
    db_conn: DatabaseConnection,
    manager: ConnectionManager,
    broadcaster: Arc<WebEventBroadcaster>,
) -> impl Future<Output = ()> + Send + 'static {
    let mut rx = broadcaster.subscribe();
    async move {
        loop {
            match rx.recv().await {
                Ok(WebEvent { channel, payload }) => {
                    if channel != "acp://event" {
                        continue;
                    }
                    let envelope: EventEnvelope = match serde_json::from_value((*payload).clone()) {
                        Ok(env) => env,
                        Err(e) => {
                            eprintln!("[lifecycle][ERROR] failed to parse envelope: {e}");
                            continue;
                        }
                    };
                    handle_event_with_retry(&db_conn, &manager, &envelope).await;
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    // Lagged means events were dropped between rx polls because
                    // the broadcast buffer (4096) overflowed. Capacity-shaped
                    // by emit_with_state's burst rate vs. our DB write speed.
                    // Logged at WARN — visible-but-non-fatal.
                    eprintln!(
                        "[lifecycle][WARN] broadcaster lagged, dropped {skipped} events \
                         (DB writes can't keep up with emit rate)"
                    );
                }
                Err(broadcast::error::RecvError::Closed) => {
                    eprintln!("[lifecycle] broadcaster closed; subscriber exiting");
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_state::SessionState;
    use crate::db::test_helpers;
    use crate::models::agent::AgentType;
    use crate::web::event_bridge::EventEmitter;
    use std::sync::Arc;
    use tokio::sync::{mpsc, RwLock};

    fn fake_connection_with_state(
        id: &str,
        conv_id: Option<i32>,
    ) -> crate::acp::connection::AgentConnection {
        let (tx, _rx) = mpsc::channel(1);
        let mut state = SessionState::new(
            id.to_string(),
            AgentType::ClaudeCode,
            None,
            "test-window".to_string(),
            None,
        );
        state.conversation_id = conv_id;
        crate::acp::connection::AgentConnection {
            id: id.to_string(),
            agent_type: AgentType::ClaudeCode,
            status: crate::acp::types::ConnectionStatus::Connected,
            owner_window_label: "test-window".to_string(),
            cmd_tx: tx,
            state: Arc::new(RwLock::new(state)),
            emitter: EventEmitter::Noop,
            prompt_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    #[tokio::test]
    async fn handle_event_writes_external_id_when_conversation_bound() {
        let db = test_helpers::fresh_in_memory_db().await;
        let folder_id = test_helpers::seed_folder(&db, "/tmp/test").await;
        let conv =
            conversation_service::create(&db.conn, folder_id, AgentType::ClaudeCode, None, None)
                .await
                .unwrap();
        let mgr = ConnectionManager::new();
        {
            let mut map = mgr.connections.lock().await;
            map.insert(
                "c1".to_string(),
                fake_connection_with_state("c1", Some(conv.id)),
            );
        }
        let env = EventEnvelope {
            seq: 1,
            connection_id: "c1".to_string(),
            payload: AcpEvent::SessionStarted {
                session_id: "ext-99".into(),
            },
        };
        handle_event(&db.conn, &mgr, &env).await.unwrap();
        let reloaded = conversation_service::get_by_id(&db.conn, conv.id)
            .await
            .unwrap();
        assert_eq!(reloaded.external_id.as_deref(), Some("ext-99"));
    }

    #[tokio::test]
    async fn handle_event_is_noop_when_no_conversation_bound() {
        let db = test_helpers::fresh_in_memory_db().await;
        // Seed a sentinel conversation row that should remain untouched.
        let folder_id = test_helpers::seed_folder(&db, "/tmp/test-noop").await;
        let sentinel =
            conversation_service::create(&db.conn, folder_id, AgentType::ClaudeCode, None, None)
                .await
                .unwrap();

        let mgr = ConnectionManager::new();
        {
            let mut map = mgr.connections.lock().await;
            map.insert("c1".to_string(), fake_connection_with_state("c1", None));
        }
        let env = EventEnvelope {
            seq: 1,
            connection_id: "c1".to_string(),
            payload: AcpEvent::SessionStarted {
                session_id: "should-not-write".into(),
            },
        };
        handle_event(&db.conn, &mgr, &env).await.unwrap();

        // Sentinel row must still have no external_id — dispatcher correctly
        // skipped the write because the connection had no conversation_id.
        let reloaded = conversation_service::get_by_id(&db.conn, sentinel.id)
            .await
            .unwrap();
        assert!(
            reloaded.external_id.is_none(),
            "sentinel row should be untouched"
        );
    }

    /// Helper: read the raw `status` column off the conversation entity
    /// (the `conversation_service::get_by_id` summary type stringifies status,
    /// which loses round-trip parity with the `ConversationStatus` enum).
    async fn read_row_status(
        db: &crate::db::AppDatabase,
        conversation_id: i32,
    ) -> ConversationStatus {
        use crate::db::entities::conversation;
        use sea_orm::EntityTrait;
        conversation::Entity::find_by_id(conversation_id)
            .one(&db.conn)
            .await
            .unwrap()
            .expect("conversation row exists")
            .status
    }

    #[tokio::test]
    async fn handle_event_writes_pending_review_on_turn_complete() {
        let db = test_helpers::fresh_in_memory_db().await;
        let folder_id = test_helpers::seed_folder(&db, "/tmp/turn-complete").await;
        let conv =
            conversation_service::create(&db.conn, folder_id, AgentType::ClaudeCode, None, None)
                .await
                .unwrap();
        // Sanity precondition: row was created in InProgress (the
        // conversation_service::create default).
        assert_eq!(
            read_row_status(&db, conv.id).await,
            ConversationStatus::InProgress
        );

        let mgr = ConnectionManager::new();
        {
            let mut map = mgr.connections.lock().await;
            map.insert(
                "c1".to_string(),
                fake_connection_with_state("c1", Some(conv.id)),
            );
        }
        let env = EventEnvelope {
            seq: 1,
            connection_id: "c1".to_string(),
            payload: AcpEvent::TurnComplete {
                session_id: "ext-1".into(),
                stop_reason: "end_turn".into(),
                agent_type: "claude_code".into(),
            },
        };
        handle_event(&db.conn, &mgr, &env).await.unwrap();
        assert_eq!(
            read_row_status(&db, conv.id).await,
            ConversationStatus::PendingReview
        );
    }

    #[tokio::test]
    async fn handle_event_pending_review_is_noop_when_no_conversation_bound() {
        let db = test_helpers::fresh_in_memory_db().await;
        let folder_id = test_helpers::seed_folder(&db, "/tmp/no-conv").await;
        // Sentinel row: must remain in its initial status (InProgress) since
        // the connection is unbound and the dispatcher should skip the write.
        let sentinel =
            conversation_service::create(&db.conn, folder_id, AgentType::ClaudeCode, None, None)
                .await
                .unwrap();
        assert_eq!(sentinel.status, ConversationStatus::InProgress);

        let mgr = ConnectionManager::new();
        {
            let mut map = mgr.connections.lock().await;
            map.insert("c1".to_string(), fake_connection_with_state("c1", None));
        }
        let env = EventEnvelope {
            seq: 1,
            connection_id: "c1".to_string(),
            payload: AcpEvent::TurnComplete {
                session_id: "ext-1".into(),
                stop_reason: "end_turn".into(),
                agent_type: "claude_code".into(),
            },
        };
        handle_event(&db.conn, &mgr, &env).await.unwrap();
        assert_eq!(
            read_row_status(&db, sentinel.id).await,
            ConversationStatus::InProgress,
            "row must be untouched when no conversation_id is bound to the connection"
        );
    }

    #[tokio::test]
    async fn handle_event_is_noop_for_unrelated_events() {
        let db = test_helpers::fresh_in_memory_db().await;
        let folder_id = test_helpers::seed_folder(&db, "/tmp/test-unrelated").await;
        let conv =
            conversation_service::create(&db.conn, folder_id, AgentType::ClaudeCode, None, None)
                .await
                .unwrap();

        let mgr = ConnectionManager::new();
        {
            let mut map = mgr.connections.lock().await;
            map.insert(
                "c1".to_string(),
                fake_connection_with_state("c1", Some(conv.id)),
            );
        }
        // ContentDelta should be a no-op even though the connection IS bound.
        let env = EventEnvelope {
            seq: 1,
            connection_id: "c1".to_string(),
            payload: AcpEvent::ContentDelta { text: "hi".into() },
        };
        handle_event(&db.conn, &mgr, &env).await.unwrap();

        let reloaded = conversation_service::get_by_id(&db.conn, conv.id)
            .await
            .unwrap();
        assert!(
            reloaded.external_id.is_none(),
            "non-SessionStarted events must not write external_id"
        );
    }
}
