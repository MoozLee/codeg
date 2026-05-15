"use client"

import {
  readScopedStorageItem,
  removeScopedStorageItem,
  writeScopedStorageItem,
  type TabPersistenceMode,
} from "@/contexts/tab-shared"

export interface MessageInputPastedTextEntry {
  id: number
  content: string
}

export interface MessageInputDraftState {
  text: string
  pastedTexts: MessageInputPastedTextEntry[]
}

const V2_STORAGE_PREFIX = "codeg:message-input-draft:v2"
const V1_STORAGE_PREFIX = "codeg:message-input-draft:v1"
const SHARED_PERSISTENCE_MODE: TabPersistenceMode = "shared"
const WINDOW_LOCAL_DRAFT_PREFIX = "window-local:"
const draftStateCache = new Map<string, MessageInputDraftState>()
const pendingPersistDrafts = new Map<string, MessageInputDraftState>()
let idlePersistHandle: number | null = null
let persistenceListenersBound = false

function storageKeyForDraftKey(
  draftKey: string,
  storagePrefix: string = V2_STORAGE_PREFIX
): string {
  return `${storagePrefix}:${draftKey}`
}

function cloneDraftState(
  state: MessageInputDraftState
): MessageInputDraftState {
  return {
    text: state.text,
    pastedTexts: state.pastedTexts.map((entry) => ({ ...entry })),
  }
}

function areDraftStatesEqual(
  a: MessageInputDraftState | undefined,
  b: MessageInputDraftState
): boolean {
  if (!a) return false
  if (a.text !== b.text) return false
  if (a.pastedTexts.length !== b.pastedTexts.length) return false
  return a.pastedTexts.every((entry, index) => {
    const other = b.pastedTexts[index]
    return entry.id === other.id && entry.content === other.content
  })
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsePastedTexts(value: unknown): MessageInputPastedTextEntry[] {
  if (!Array.isArray(value)) return []
  const entries: MessageInputPastedTextEntry[] = []
  const seenIds = new Set<number>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const { id, content } = item
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) continue
    if (typeof content !== "string") continue
    if (seenIds.has(id)) continue
    seenIds.add(id)
    entries.push({ id, content })
  }
  return entries
}

function parseDraftState(value: unknown): MessageInputDraftState | null {
  if (!isRecord(value)) return null
  if (typeof value.text !== "string") return null
  return {
    text: value.text,
    pastedTexts: parsePastedTexts(value.pastedTexts),
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

  for (const [draftKey, state] of entries) {
    const { persistenceMode, scopedDraftKey } = resolveDraftScope(draftKey)
    writeScopedStorageItem(
      persistenceMode,
      storageKeyForDraftKey(scopedDraftKey),
      JSON.stringify(state)
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

export function loadMessageInputDraft(
  draftKey: string
): MessageInputDraftState | null {
  const cached = draftStateCache.get(draftKey)
  if (cached) return cloneDraftState(cached)
  if (typeof window === "undefined") return null

  const { persistenceMode, scopedDraftKey } = resolveDraftScope(draftKey)

  try {
    const raw = readScopedStorageItem(
      persistenceMode,
      storageKeyForDraftKey(scopedDraftKey)
    )
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      const state = parseDraftState(parsed)
      if (state) {
        draftStateCache.set(draftKey, cloneDraftState(state))
        return state
      }
    }

    const legacyRaw = readScopedStorageItem(
      persistenceMode,
      storageKeyForDraftKey(scopedDraftKey, V1_STORAGE_PREFIX)
    )
    if (!legacyRaw) return null
    const legacyParsed: unknown = JSON.parse(legacyRaw)
    const legacyState = parseDraftState(legacyParsed)
    if (!legacyState) return null
    const state: MessageInputDraftState = {
      text: legacyState.text,
      pastedTexts: [],
    }
    draftStateCache.set(draftKey, cloneDraftState(state))
    return state
  } catch {
    return null
  }
}

export function saveMessageInputDraft(
  draftKey: string,
  state: MessageInputDraftState
): void {
  const normalized: MessageInputDraftState = {
    text: state.text,
    pastedTexts: parsePastedTexts(state.pastedTexts),
  }

  if (normalized.pastedTexts.length !== state.pastedTexts.length) {
    normalized.pastedTexts = []
  }

  if (normalized.text.length === 0) {
    clearMessageInputDraft(draftKey)
    return
  }

  if (areDraftStatesEqual(draftStateCache.get(draftKey), normalized)) return
  draftStateCache.set(draftKey, cloneDraftState(normalized))
  if (typeof window === "undefined") return

  pendingPersistDrafts.set(draftKey, cloneDraftState(normalized))
  scheduleDraftPersistence()
}

export function clearMessageInputDraft(draftKey: string): void {
  draftStateCache.delete(draftKey)
  pendingPersistDrafts.delete(draftKey)
  if (typeof window === "undefined") return

  const { persistenceMode, scopedDraftKey } = resolveDraftScope(draftKey)
  removeScopedStorageItem(
    persistenceMode,
    storageKeyForDraftKey(scopedDraftKey)
  )
  removeScopedStorageItem(
    persistenceMode,
    storageKeyForDraftKey(scopedDraftKey, V1_STORAGE_PREFIX)
  )
}
