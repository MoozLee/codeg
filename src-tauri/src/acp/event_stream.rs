use std::collections::VecDeque;
use std::sync::Arc;

use tokio::sync::broadcast;

use crate::acp::types::EventEnvelope;

/// Capacity of the per-connection broadcast channel. Sized to absorb a brief
/// burst when a slow subscriber lags; broadcast::channel drops oldest events
/// past capacity (RecvError::Lagged), which the subscriber surfaces as a
/// `replay_lagged` cue and the client converts to a re-attach.
const BROADCAST_CAPACITY: usize = 4096;

/// Maximum byte total retained in the recent-events ring buffer. Sized so
/// even an active streaming session with several tool-call updates fits
/// comfortably; oversized images push past this bound and force a snapshot
/// fallback on the next attach (see `RecentEventsBuffer::push`).
pub const RECENT_BUFFER_MAX_BYTES: usize = 128 * 1024;

/// Hard cap on event count regardless of byte total. Defends against a
/// pathological flood of tiny events filling the buffer past the byte limit
/// (each event has a small overhead — connection_id, seq — that doesn't
/// contribute meaningfully to byte_total but does to memory).
pub const RECENT_BUFFER_MAX_COUNT: usize = 128;

/// Single-event size threshold above which we refuse to store the event.
/// Stored events would be replayed on reconnect; an oversized event blows
/// past WS frame budgets. The next attach for such a connection will fall
/// through to a snapshot, which is the right thing for large state.
const RECENT_EVENT_MAX_BYTES: usize = 64 * 1024;

/// Per-connection event broadcaster + recent-events ring buffer.
///
/// Lives on `SessionState` (one per active ACP connection). All event
/// emission for a connection goes through `emit_with_state`, which holds
/// the SessionState write lock while:
///   1. applying the event
///   2. incrementing event_seq
///   3. pushing the resulting envelope into `recent_events`
///
/// then releases the lock and broadcasts via `sender`.
///
/// New WS subscribers (`attach`) hold the SessionState **read** lock while:
///   1. snapshotting the state and event_seq
///   2. (optionally) reading recent_events for replay
///   3. calling `subscribe()` on this stream
///
/// then release the lock.
///
/// Holding the read lock across subscribe() guarantees no event broadcast
/// races between the snapshot read and receiver registration: the only
/// path that produces broadcasts is `emit_with_state`, which needs the
/// write lock and therefore waits.
#[derive(Debug)]
pub struct ConnectionEventStream {
    sender: broadcast::Sender<Arc<EventEnvelope>>,
}

impl Default for ConnectionEventStream {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionEventStream {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(BROADCAST_CAPACITY);
        Self { sender }
    }

    /// Register a new subscriber. Must be called while holding at least a
    /// read lock on the owning `SessionState`, otherwise events emitted
    /// after the snapshot read but before subscribe can be missed.
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<EventEnvelope>> {
        self.sender.subscribe()
    }

    /// Broadcast an envelope. Failure (no subscribers) is ignored — the
    /// event is already recorded in `SessionState.recent_events` for the
    /// next attach to pick up via replay.
    pub fn send(&self, envelope: Arc<EventEnvelope>) {
        let _ = self.sender.send(envelope);
    }
}

/// Bounded ring buffer of recent events, used to replay short reconnect
/// gaps without forcing a full snapshot. Two limits are enforced together:
/// `MAX_BYTES` (network/memory) and `MAX_COUNT` (defense-in-depth against
/// many tiny events).
#[derive(Debug)]
pub struct RecentEventsBuffer {
    events: VecDeque<RecentEntry>,
    byte_total: usize,
}

#[derive(Debug)]
struct RecentEntry {
    seq: u64,
    size: usize,
    envelope: Arc<EventEnvelope>,
}

impl Default for RecentEventsBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl RecentEventsBuffer {
    pub fn new() -> Self {
        Self {
            events: VecDeque::with_capacity(32),
            byte_total: 0,
        }
    }

    /// Push an envelope. If estimated size exceeds the per-event limit, the
    /// envelope is silently skipped — an attach with a cursor pointing at
    /// or before this seq will detect the gap and fall back to a snapshot.
    ///
    /// Returns the number of events evicted by this push (FIFO eviction
    /// triggered by either count cap or byte cap, plus the wholesale clear
    /// for oversized events). Callers wire this into `EventBusMetrics::
    /// ring_buffer_evict_count` so operators can detect ring-buffer pressure.
    #[must_use = "evicted count feeds the ring_buffer_evict_count metric"]
    pub fn push(&mut self, envelope: Arc<EventEnvelope>) -> usize {
        let size = estimate_envelope_size(&envelope);
        if size > RECENT_EVENT_MAX_BYTES {
            // Mark the gap implicitly: the next event will appear non-contiguous
            // relative to its predecessor, and `range_after` returns None.
            // Drop the entire buffer so a subsequent attach with an old cursor
            // takes the snapshot path rather than returning a misleading
            // partial replay.
            let evicted = self.events.len();
            self.events.clear();
            self.byte_total = 0;
            return evicted;
        }
        let seq = envelope.seq;
        self.events.push_back(RecentEntry {
            seq,
            size,
            envelope,
        });
        self.byte_total = self.byte_total.saturating_add(size);
        let mut evicted = 0;
        while self.events.len() > RECENT_BUFFER_MAX_COUNT
            || self.byte_total > RECENT_BUFFER_MAX_BYTES
        {
            match self.events.pop_front() {
                Some(old) => {
                    self.byte_total = self.byte_total.saturating_sub(old.size);
                    evicted += 1;
                }
                None => break,
            }
        }
        evicted
    }

    /// Returns events with seq strictly greater than `since_seq`, in order.
    /// `None` indicates the cursor is older than the oldest buffered seq —
    /// caller must fall back to a snapshot rather than send partial replay.
    pub fn range_after(&self, since_seq: u64) -> Option<Vec<Arc<EventEnvelope>>> {
        let oldest = self.events.front()?.seq;
        // since_seq + 1 is the first seq we'd want; if our oldest is past
        // that, there's a gap we can't fill.
        if oldest > since_seq.saturating_add(1) {
            return None;
        }
        Some(
            self.events
                .iter()
                .filter(|e| e.seq > since_seq)
                .map(|e| e.envelope.clone())
                .collect(),
        )
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.events.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    #[cfg(test)]
    pub fn byte_total(&self) -> usize {
        self.byte_total
    }
}

/// Best-effort size estimate for an event envelope. Uses serialized JSON
/// length, falling back to a small constant if serialization fails (which
/// shouldn't happen for well-formed AcpEvents but we don't want to panic).
fn estimate_envelope_size(envelope: &EventEnvelope) -> usize {
    serde_json::to_vec(envelope).map(|v| v.len()).unwrap_or(256)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::types::AcpEvent;

    fn make_envelope(seq: u64, text: &str) -> Arc<EventEnvelope> {
        Arc::new(EventEnvelope {
            seq,
            connection_id: "c".into(),
            payload: AcpEvent::ContentDelta { text: text.into() },
        })
    }

    #[test]
    fn push_and_range_after_returns_strictly_greater_seq() {
        let mut buf = RecentEventsBuffer::new();
        assert_eq!(buf.push(make_envelope(1, "a")), 0);
        assert_eq!(buf.push(make_envelope(2, "b")), 0);
        assert_eq!(buf.push(make_envelope(3, "c")), 0);

        let after_1 = buf.range_after(1).expect("cursor in range");
        assert_eq!(after_1.len(), 2);
        assert_eq!(after_1[0].seq, 2);
        assert_eq!(after_1[1].seq, 3);

        let after_3 = buf.range_after(3).expect("cursor at head");
        assert!(after_3.is_empty(), "no events past head");
    }

    #[test]
    fn range_after_returns_none_when_cursor_older_than_oldest() {
        let mut buf = RecentEventsBuffer::new();
        // Force eviction so seq=1 is gone.
        for s in 1..=(RECENT_BUFFER_MAX_COUNT as u64 + 5) {
            let _ = buf.push(make_envelope(s, "x"));
        }
        // Ask for events past a seq the buffer no longer holds.
        assert!(buf.range_after(1).is_none());
        // But a recent seq should still work.
        assert!(buf
            .range_after(buf.events.back().unwrap().seq - 1)
            .is_some());
    }

    #[test]
    fn count_cap_evicts_oldest_and_reports_eviction_count() {
        let mut buf = RecentEventsBuffer::new();
        let mut total_evicted = 0usize;
        for s in 1..=(RECENT_BUFFER_MAX_COUNT as u64 + 10) {
            total_evicted += buf.push(make_envelope(s, "x"));
        }
        assert_eq!(buf.len(), RECENT_BUFFER_MAX_COUNT);
        assert_eq!(
            total_evicted, 10,
            "10 events should have been evicted to keep buffer at cap"
        );
        // Oldest should be (total pushed - cap + 1).
        let pushed = RECENT_BUFFER_MAX_COUNT + 10;
        let expected_oldest_seq = (pushed - RECENT_BUFFER_MAX_COUNT) as u64 + 1;
        assert_eq!(buf.events.front().unwrap().seq, expected_oldest_seq);
    }

    #[test]
    fn byte_cap_evicts_to_stay_under_limit() {
        let mut buf = RecentEventsBuffer::new();
        // Each event ~1KB of text. Push enough to exceed MAX_BYTES.
        let chunk = "x".repeat(1024);
        let n = (RECENT_BUFFER_MAX_BYTES / 1024) as u64 + 10;
        for s in 1..=n {
            let _ = buf.push(make_envelope(s, &chunk));
        }
        assert!(
            buf.byte_total() <= RECENT_BUFFER_MAX_BYTES,
            "byte_total {} exceeded limit {}",
            buf.byte_total(),
            RECENT_BUFFER_MAX_BYTES
        );
    }

    #[test]
    fn oversized_event_drops_entire_buffer_and_reports_eviction() {
        let mut buf = RecentEventsBuffer::new();
        assert_eq!(buf.push(make_envelope(1, "a")), 0);
        assert_eq!(buf.push(make_envelope(2, "b")), 0);
        // Push an event larger than the per-event limit.
        let huge = "z".repeat(RECENT_EVENT_MAX_BYTES + 1);
        let evicted = buf.push(make_envelope(3, &huge));
        assert_eq!(
            evicted, 2,
            "wholesale clear must report the count of cleared entries"
        );
        // The previous events are gone; the next attach must take the
        // snapshot path because `range_after(0)` returns None.
        assert!(buf.range_after(0).is_none());
        assert!(buf.range_after(2).is_none());
    }

    #[test]
    fn broadcast_send_is_lossless_under_capacity() {
        let stream = ConnectionEventStream::new();
        let mut rx = stream.subscribe();
        for s in 1..=10 {
            stream.send(make_envelope(s, "x"));
        }
        for s in 1..=10 {
            let env = rx.try_recv().expect("event delivered");
            assert_eq!(env.seq, s);
        }
    }
}
