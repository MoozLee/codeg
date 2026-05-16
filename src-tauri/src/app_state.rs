use std::path::PathBuf;
use std::sync::Arc;

use crate::acp::manager::ConnectionManager;
use crate::acp::InternalEventBus;
use crate::chat_channel::manager::ChatChannelManager;
use crate::commands::provider_usage::UsageCache;
use crate::db::AppDatabase;
use crate::pet_state_mapper::PetStateHandle;
use crate::terminal::manager::TerminalManager;
use crate::web::event_bridge::{EventEmitter, WebEventBroadcaster};
use crate::web::WebServerState;

pub struct AppState {
    pub db: AppDatabase,
    pub connection_manager: ConnectionManager,
    pub terminal_manager: TerminalManager,
    pub event_broadcaster: Arc<WebEventBroadcaster>,
    /// Process-wide bus for typed `Arc<EventEnvelope>` delivery to
    /// in-process consumers (lifecycle, pet state mapper, chat-channel
    /// subscribers). Distinct from `event_broadcaster`, which carries
    /// JSON-shaped `WebEvent`s for transport-bound delivery.
    pub acp_event_bus: Arc<InternalEventBus>,
    pub emitter: EventEmitter,
    pub data_dir: PathBuf,
    pub web_server_state: WebServerState,
    pub chat_channel_manager: ChatChannelManager,
    /// Latest ambient `PetState` written by `pet_state_subscriber_task`.
    /// Read by `pet_get_current_state` so a freshly-opened pet window can
    /// pick up the current state without waiting for the next transition.
    pub pet_state: PetStateHandle,
    /// Shared cache of provider usage query results + auto-refresh task
    /// handles. Populated lazily by `refresh_all_enabled` at startup and by
    /// CRUD operations that re-run the outbound query.
    pub provider_usage_cache: Arc<UsageCache>,
}

pub fn default_connection_manager() -> ConnectionManager {
    ConnectionManager::new()
}

pub fn default_terminal_manager() -> TerminalManager {
    TerminalManager::new()
}

pub fn default_chat_channel_manager() -> ChatChannelManager {
    ChatChannelManager::new()
}

pub fn default_provider_usage_cache() -> Arc<UsageCache> {
    Arc::new(UsageCache::new())
}
