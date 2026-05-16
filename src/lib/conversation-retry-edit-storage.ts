import type { MessageTurn } from "@/lib/types"

const STORAGE_KEY_PREFIX = "codeg:conversation-retry-edit-replacements:v1"
const STORAGE_EVENT = "codeg:conversation-retry-edit-replacements-changed"

export interface ConversationRetryEditReplacement {
  old_anchor_id: string
  created_at: string
}

function buildStorageKey(conversationId: number): string {
  return `${STORAGE_KEY_PREFIX}:${conversationId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isStableAnchorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("optimistic:")
  )
}

function normalizeReplacement(
  value: unknown
): ConversationRetryEditReplacement | null {
  if (!isRecord(value)) return null
  if (!isStableAnchorId(value.old_anchor_id)) return null

  const createdAt =
    typeof value.created_at === "string" && value.created_at.length > 0
      ? value.created_at
      : new Date(0).toISOString()

  return {
    old_anchor_id: value.old_anchor_id,
    created_at: createdAt,
  }
}

function emitReplacementChange(conversationId: number): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<{ conversationId: number }>(STORAGE_EVENT, {
      detail: { conversationId },
    })
  )
}

export function isStableRetryEditAnchorId(
  anchorId: string | null | undefined
): anchorId is string {
  return isStableAnchorId(anchorId)
}

export function loadConversationRetryEditReplacements(
  conversationId: number
): ConversationRetryEditReplacement[] {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return []
  }
  if (typeof window === "undefined") return []

  try {
    const raw = localStorage.getItem(buildStorageKey(conversationId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const byOldAnchorId = new Map<string, ConversationRetryEditReplacement>()
    for (const entry of parsed) {
      const normalized = normalizeReplacement(entry)
      if (!normalized) continue
      byOldAnchorId.set(normalized.old_anchor_id, normalized)
    }
    return Array.from(byOldAnchorId.values())
  } catch {
    return []
  }
}

export function saveConversationRetryEditReplacement(
  conversationId: number,
  replacement: ConversationRetryEditReplacement
): void {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return
  }
  if (!isStableAnchorId(replacement.old_anchor_id)) return
  if (typeof window === "undefined") return

  try {
    const existing = loadConversationRetryEditReplacements(conversationId)
    const nextByOldAnchorId = new Map(
      existing.map((entry) => [entry.old_anchor_id, entry])
    )
    nextByOldAnchorId.set(replacement.old_anchor_id, {
      old_anchor_id: replacement.old_anchor_id,
      created_at: replacement.created_at,
    })
    localStorage.setItem(
      buildStorageKey(conversationId),
      JSON.stringify(Array.from(nextByOldAnchorId.values()))
    )
    emitReplacementChange(conversationId)
  } catch {
    /* ignore */
  }
}

export function clearConversationRetryEditReplacements(
  conversationId: number
): void {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return
  }
  if (typeof window === "undefined") return

  try {
    localStorage.removeItem(buildStorageKey(conversationId))
    emitReplacementChange(conversationId)
  } catch {
    /* ignore */
  }
}

export function collectHiddenRetryEditAnchorIds(
  conversationId: number,
  turns: MessageTurn[]
): Set<string> {
  const replacements = loadConversationRetryEditReplacements(conversationId)
  if (replacements.length === 0) return new Set()

  const presentStableUserAnchors = new Set(
    turns
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.anchor_id ?? null)
      .filter(isStableAnchorId)
  )

  const hidden = new Set<string>()
  for (const replacement of replacements) {
    if (presentStableUserAnchors.has(replacement.old_anchor_id)) {
      hidden.add(replacement.old_anchor_id)
    }
  }
  return hidden
}

export function addConversationRetryEditReplacementListener(
  listener: (conversationId: number) => void
): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<{ conversationId?: unknown }>
    const conversationId = customEvent.detail?.conversationId
    if (typeof conversationId === "number") {
      listener(conversationId)
    }
  }
  const handleStorageEvent = (event: StorageEvent) => {
    if (!event.key?.startsWith(STORAGE_KEY_PREFIX)) return
    const suffix = event.key.slice(STORAGE_KEY_PREFIX.length + 1)
    const conversationId = Number(suffix)
    if (Number.isFinite(conversationId)) {
      listener(conversationId)
    }
  }

  window.addEventListener(STORAGE_EVENT, handleCustomEvent)
  window.addEventListener("storage", handleStorageEvent)
  return () => {
    window.removeEventListener(STORAGE_EVENT, handleCustomEvent)
    window.removeEventListener("storage", handleStorageEvent)
  }
}
