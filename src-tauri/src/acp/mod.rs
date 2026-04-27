pub mod binary_cache;
pub mod connection;
pub mod error;
pub mod file_system_runtime;
pub mod fork;
pub mod lifecycle;
pub mod manager;
pub mod opencode_plugins;
pub mod preflight;
pub mod registry;
pub mod session_state;
pub mod terminal_runtime;
pub mod types;

pub use lifecycle::lifecycle_subscriber_task;
pub use session_state::{LiveSessionSnapshot, SessionState};
// Re-export the inner types of LiveSessionSnapshot for downstream consumers; not all are
// directly named in Rust today (they ride along through the snapshot struct), so silence
// dead-import warnings rather than dropping them.
#[allow(unused_imports)]
pub use session_state::{
    LiveContentBlock, LiveMessage, PendingPermissionState, ToolCallOutput, ToolCallState,
    ToolCallStatus, ToolKind, UsageInfo,
};
pub use types::{AcpEvent, EventEnvelope};
