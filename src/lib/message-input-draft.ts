"use client"

import {
  readScopedStorageItem,
  removeScopedStorageItem,
  writeScopedStorageItem,
  type TabPersistenceMode,
} from "@/contexts/tab-shared"

interface PersistedDraftState {
  text: string
}

const STORAGE_PREFIX = "codeg:message-input-draft:v1"
const SHARED_PERSISTENCE_MODE: TabPersistenceMode = "shared"
const WINDOW_LOCAL_DRAFT_PREFIX = "window-local:"
const draftTextCache = new Map<string, string>()
const pendingPersistDrafts = new Map<string, string>()
let idlePersistHandle: number | null = null
let persistenceListenersBound = false

function storageKeyForDraftKey(draftKey: string): string {
  return `${STORAGE_PREFIX}:${draftKey}`
}

function resolveDraftScope(draftKey: string): {
  persistenceMode: TabPersistenceMode
  scopedDraftKey: string
} {
  if (draftKey.startsWith(WINDOW_LOCAL_DRAFT_PREFIX)) {
    return {
      persistenceMode: "window-local",
      scopedDraftKey: draftKey.slice(WINDOW_LOCAL_DRAFT_PREFIX.length),
    }
  }

  return {
    persistenceMode: SHARED_PERSISTENCE_MODE,
    scopedDraftKey: draftKey,
  }
}

function flushPendingDraftPersistence(): void {
  if (typeof window === "undefined") return
  if (pendingPersistDrafts.size === 0) {
    idlePersistHandle = null
    return
  }

  const entries = Array.from(pendingPersistDrafts.entries())
  pendingPersistDrafts.clear()
  idlePersistHandle = null

  for (const [draftKey, text] of entries) {
    const { persistenceMode, scopedDraftKey } = resolveDraftScope(draftKey)
    writeScopedStorageItem(
      persistenceMode,
      storageKeyForDraftKey(scopedDraftKey),
      JSON.stringify({ text })
    )
  }
}

function cancelScheduledDraftPersistence(): void {
  if (typeof window === "undefined") return
  if (idlePersistHandle == null) return
  if ("cancelIdleCallback" in window) {
    window.cancelIdleCallback(idlePersistHandle)
  }
  idlePersistHandle = null
}

function ensurePersistenceListeners(): void {
  if (typeof window === "undefined") return
  if (persistenceListenersBound) return
  persistenceListenersBound = true

  const flushNow = () => {
    cancelScheduledDraftPersistence()
    flushPendingDraftPersistence()
  }

  window.addEventListener("pagehide", flushNow)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushNow()
    }
  })
}

function scheduleDraftPersistence(): void {
  if (typeof window === "undefined") return
  if (idlePersistHandle != null) return

  ensurePersistenceListeners()
  if ("requestIdleCallback" in window) {
    idlePersistHandle = window.requestIdleCallback(() => {
      flushPendingDraftPersistence()
    })
    return
  }

  // Fallback for runtimes without requestIdleCallback.
  flushPendingDraftPersistence()
}

export function buildConversationDraftStorageKey(
  conversationId: number
): string {
  return `conv:${conversationId}`
}

export function buildNewConversationDraftStorageKey(
  persistenceMode: TabPersistenceMode = SHARED_PERSISTENCE_MODE
): string {
  return persistenceMode === "window-local"
    ? `${WINDOW_LOCAL_DRAFT_PREFIX}new`
    : "new"
}

export function loadMessageInputDraft(draftKey: string): string | null {
  const cached = draftTextCache.get(draftKey)
  if (typeof cached === "string") return cached
  if (typeof window === "undefined") return null

  const { persistenceMode, scopedDraftKey } = resolveDraftScope(draftKey)

  try {
    const raw = readScopedStorageItem(
      persistenceMode,
      storageKeyForDraftKey(scopedDraftKey)
    )
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedDraftState>
    if (typeof parsed.text !== "string") return null
    draftTextCache.set(draftKey, parsed.text)
    return parsed.text
  } catch {
    return null
  }
}

export function saveMessageInputDraft(draftKey: string, text: string): void {
  if (text.length === 0) {
    clearMessageInputDraft(draftKey)
    return
  }

  if (draftTextCache.get(draftKey) === text) return
  draftTextCache.set(draftKey, text)
  if (typeof window === "undefined") return

  pendingPersistDrafts.set(draftKey, text)
  scheduleDraftPersistence()
}

export function clearMessageInputDraft(draftKey: string): void {
  draftTextCache.delete(draftKey)
  pendingPersistDrafts.delete(draftKey)
  if (typeof window === "undefined") return

  const { persistenceMode, scopedDraftKey } = resolveDraftScope(draftKey)
  removeScopedStorageItem(
    persistenceMode,
    storageKeyForDraftKey(scopedDraftKey)
  )
}
