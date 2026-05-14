use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::{
    extract::{Extension, WebSocketUpgrade},
    response::IntoResponse,
};

use super::shutdown::ShutdownSignal;
use crate::app_state::AppState;

// MUST match `WS_READY_CHANNEL` in `src/lib/transport/constants.ts`.
// Drift between the two values silently breaks the handshake (the client
// keeps waiting and falls back to the timeout warning path after 5 s).
const WS_READY_CHANNEL: &str = "__ready__";

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Extension(state): Extension<Arc<AppState>>,
    Extension(shutdown_signal): Extension<Arc<ShutdownSignal>>,
) -> impl IntoResponse {
    ws.protocols([super::auth::WS_EVENT_PROTOCOL])
        .on_upgrade(|socket| handle_ws_connection(socket, state, shutdown_signal))
}

async fn handle_ws_connection(
    mut socket: WebSocket,
    state: Arc<AppState>,
    shutdown_signal: Arc<ShutdownSignal>,
) {
    // Late handshake guard: if shutdown already fired before this task
    // even started, exit before subscribing to anything else.
    if shutdown_signal.is_triggered() {
        let _ = socket.send(Message::Close(None)).await;
        return;
    }

    let mut rx = state.event_broadcaster.subscribe();

    // Server→client ready handshake. The broadcaster's `send` drops events
    // when `receiver_count == 0`; without this signal the client has no way
    // to know its receiver is registered, and any event emitted between WS
    // open and the `subscribe()` call above is lost. Sending `__ready__` AFTER
    // subscribing lets the client gate `acp_connect` until events are safe
    // to emit — fixes the "正在连接" stuck-on-connecting race in web mode.
    let ready_payload = serde_json::json!({
        "channel": WS_READY_CHANNEL,
        "payload": null,
    });
    match serde_json::to_string(&ready_payload) {
        Ok(text) => {
            if let Err(e) = socket.send(Message::Text(text.into())).await {
                // Client likely disconnected mid-handshake. Logged so the
                // matching client-side timeout warning has a server-side
                // counterpart when diagnosing "stuck on connecting" reports.
                eprintln!("[WS][WARN] failed to send __ready__ frame: {e}");
                return;
            }
        }
        Err(e) => {
            eprintln!("[WS][WARN] failed to serialize __ready__ frame: {e}");
            return;
        }
    }

    loop {
        tokio::select! {
            // Server-initiated shutdown: close the socket cleanly so hyper's
            // graceful drain can resolve and the listener is dropped without
            // waiting for the 2 s abort fallback in do_stop_web_server.
            _ = shutdown_signal.wait() => {
                let _ = socket.send(Message::Close(None)).await;
                break;
            }
            result = rx.recv() => {
                match result {
                    Ok(event) => {
                        if let Ok(msg) = serde_json::to_string(&event) {
                            if socket.send(Message::Text(msg.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // Capacity-shaped by emit_with_state's burst rate vs.
                        // the WebSocket client's read speed. Logged at WARN —
                        // visible-but-non-fatal; the client will receive the
                        // next event but missed the dropped ones.
                        eprintln!("[WS][WARN] receiver lagged, skipped {n} events");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(_)) => {
                        // Client messages currently unused; reserved for future use
                    }
                    _ => break,
                }
            }
        }
    }
}
