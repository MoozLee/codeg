use serde::Serialize;

#[derive(thiserror::Error)]
pub enum AcpError {
    #[error("Agent process could not be started. Check Agent Settings and diagnostics.")]
    SpawnFailed(String),
    #[error("Connection was not found.")]
    ConnectionNotFound(String),
    #[error("Agent operation failed. Check Agent Settings and diagnostics.")]
    Protocol(String),
    #[error("Agent is disabled in settings.")]
    AgentDisabled,
    #[error("agent process exited unexpectedly")]
    ProcessExited,
    /// A prompt arrived while this connection already had a turn in flight.
    /// The connection loop processes one turn at a time; a second concurrent
    /// prompt (e.g. two co-controlling clients sending near-simultaneously)
    /// is rejected here rather than silently dropped after a false success.
    /// The frontend recognizes this (via the stable Display text, carried as
    /// the error message on both transports) and re-queues the draft in the
    /// message queue above the input box instead of surfacing an error.
    #[error("turn already in progress for this connection")]
    TurnInProgress,
    /// Live feedback was submitted while no turn was in flight. Feedback only
    /// makes sense while the agent is working (it is pulled mid-turn via the
    /// `check_user_feedback` MCP tool); with no active turn there is nothing to
    /// steer. The frontend recognizes this (stable Display text) and falls back
    /// to sending the text as an ordinary prompt instead.
    #[error("no active turn to send feedback to")]
    NoActiveTurn,
    /// Live feedback was submitted while the feature is disabled. The settings
    /// toggle gates both MCP tool injection and the UI affordance; this is the
    /// backend's defense-in-depth for a direct/stale call.
    #[error("live feedback is disabled")]
    FeedbackDisabled,
    /// The submitted feedback note is empty or exceeds the per-note size bound.
    /// The full text rides in the broadcast event + snapshot + MCP response, so
    /// a sanity bound keeps a single pathological note from bloating them.
    #[error("Feedback is invalid.")]
    InvalidFeedback(String),
    #[error("Agent download failed. Check Agent Settings and diagnostics.")]
    DownloadFailed(String),
    #[error("This agent is not supported on the current platform.")]
    PlatformNotSupported(String),
    #[error("Agent runtime is not installed. Install it from Agent Settings.")]
    SdkNotInstalled(String),
    #[error("Agent did not respond to Initialize within 60 seconds. The cached binary may be outdated or incompatible. Try upgrading it from Agent Settings.")]
    InitializeTimeout,
    #[error("Agent did not publish its configurable options within 60 seconds. The probe was aborted; the agent may be slow, idle, or not ACP-compliant — try again or check the agent binary.")]
    ProbeTimedOut,
}

impl std::fmt::Debug for AcpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AcpError")
            .field("code", &self.code())
            .field("message", &self.to_string())
            .finish()
    }
}

impl AcpError {
    /// Convert arbitrary protocol text to a safe, stable message. Agent stderr,
    /// file paths, and provider responses must not enter API errors or logs.
    pub fn protocol(raw: impl Into<String>) -> Self {
        let raw = raw.into();
        let message = if is_executable_format_error(&raw) {
            "Agent executable appears incompatible or corrupted. Please retry to re-download it."
        } else {
            "Agent operation failed. Check Agent Settings and diagnostics."
        };
        Self::Protocol(message.into())
    }

    /// Stable machine-readable identifier for this error kind.
    ///
    /// Returned to the frontend alongside the human-readable message so the UI
    /// can render a localized message based on the code instead of parsing
    /// English text.
    pub fn code(&self) -> Option<&'static str> {
        match self {
            Self::SdkNotInstalled(_) => Some("sdk_not_installed"),
            Self::PlatformNotSupported(_) => Some("platform_not_supported"),
            Self::AgentDisabled => Some("agent_disabled"),
            Self::InitializeTimeout => Some("initialize_timeout"),
            Self::ProbeTimedOut => Some("probe_timed_out"),
            Self::ProcessExited => Some("process_exited"),
            Self::TurnInProgress => Some("turn_in_progress"),
            Self::NoActiveTurn => Some("no_active_turn"),
            Self::FeedbackDisabled => Some("feedback_disabled"),
            Self::InvalidFeedback(_) => Some("invalid_feedback"),
            Self::SpawnFailed(_) => Some("spawn_failed"),
            Self::DownloadFailed(_) => Some("download_failed"),
            Self::ConnectionNotFound(_) => Some("connection_not_found"),
            Self::Protocol(_) => Some("protocol_error"),
        }
    }
}

impl Serialize for AcpError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

fn is_executable_format_error(message: &str) -> bool {
    let lowered = message.to_lowercase();
    lowered.contains("malformed mach-o file")
        || lowered.contains("exec format error")
        || lowered.contains("bad cpu type in executable")
        || lowered.contains("not a valid win32 application")
        || lowered.contains("is not a valid application for this os platform")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_error_forms_exclude_dynamic_details() {
        let path = "/Users/diagnostics-sensitive/private/config.json";
        let token = "diagnostics-token-secret";
        let errors = [
            AcpError::protocol(format!("agent stderr at {path}: {token}")),
            AcpError::SpawnFailed(format!("failed to spawn {path}: {token}")),
            AcpError::DownloadFailed(format!("download {token} to {path}")),
            AcpError::InvalidFeedback(format!("feedback: {token}")),
            AcpError::AgentDisabled,
        ];

        for error in errors {
            let serialized = serde_json::to_string(&error).unwrap();
            let debug = format!("{error:?}");
            for sensitive in [path, token] {
                assert!(!error.to_string().contains(sensitive));
                assert!(!serialized.contains(sensitive));
                assert!(!debug.contains(sensitive));
            }
        }
    }
}
