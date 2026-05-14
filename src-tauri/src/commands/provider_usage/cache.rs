//! In-memory cache of `ProviderUsageResult`s plus handles to each enabled
//! config's auto-refresh task. The cache is authoritative for the status bar
//! and settings list while the app is running; nothing is persisted to the
//! database (per PRD) so a restart re-queries every enabled config.
//!
//! Concurrency:
//!
//! - `results` is a `tokio::sync::RwLock<HashMap<i32, ProviderUsageResult>>`.
//!   Readers (`list`, `get`) acquire `.read()`, writers (`upsert`, `remove`)
//!   acquire `.write()`. Contention is low — updates happen once per refresh
//!   interval per config.
//! - `refresh_tasks` is a `tokio::sync::Mutex<HashMap<i32, JoinHandle>>`.
//!   Cancellation aborts the current handle and removes it from the map.
//!   We deliberately hold only short critical sections (insert/abort/remove)
//!   to keep this uncontended under normal CRUD traffic.

use std::collections::HashMap;

use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::models::provider_usage::ProviderUsageResult;

pub struct UsageCache {
    results: RwLock<HashMap<i32, ProviderUsageResult>>,
    refresh_tasks: Mutex<HashMap<i32, JoinHandle<()>>>,
}

impl Default for UsageCache {
    fn default() -> Self {
        Self::new()
    }
}

impl UsageCache {
    pub fn new() -> Self {
        Self {
            results: RwLock::new(HashMap::new()),
            refresh_tasks: Mutex::new(HashMap::new()),
        }
    }

    /// Snapshot all cached results, sorted by `config_id` for deterministic
    /// output (nicer for tests, logs, and UI ordering on first paint).
    pub async fn get_all(&self) -> Vec<ProviderUsageResult> {
        let map = self.results.read().await;
        let mut out: Vec<ProviderUsageResult> = map.values().cloned().collect();
        out.sort_by_key(|r| r.config_id);
        out
    }

    pub async fn get(&self, id: i32) -> Option<ProviderUsageResult> {
        self.results.read().await.get(&id).cloned()
    }

    /// Insert or replace a result. Does not broadcast — callers decide
    /// whether a cache update should emit the `provider_usage:updated`
    /// event (e.g. test_provider_usage_config deliberately skips it).
    pub async fn upsert(&self, result: ProviderUsageResult) {
        let id = result.config_id;
        self.results.write().await.insert(id, result);
    }

    /// Remove cached result and cancel any running refresh task for `id`.
    pub async fn remove(&self, id: i32) {
        self.results.write().await.remove(&id);
        self.cancel_task(id).await;
    }

    /// Abort + remove the refresh task for `id` without touching the cached
    /// result. Used when an update changes the interval or disables the
    /// config but leaves the most recent snapshot visible.
    pub async fn cancel_task(&self, id: i32) {
        let mut tasks = self.refresh_tasks.lock().await;
        if let Some(handle) = tasks.remove(&id) {
            handle.abort();
        }
    }

    /// Register a freshly spawned auto-refresh task. Any previous task for
    /// `id` is aborted first so a rapid enabled/disabled toggle can't leak
    /// overlapping loops.
    pub async fn register_task(&self, id: i32, handle: JoinHandle<()>) {
        let mut tasks = self.refresh_tasks.lock().await;
        if let Some(old) = tasks.insert(id, handle) {
            old.abort();
        }
    }
}
