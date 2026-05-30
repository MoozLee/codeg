import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react"
import {
  ALL_AGENT_TYPES,
  type AgentType,
  type ConversationStatus,
} from "@/lib/types"

export interface TabItemInternal {
  id: string
  kind: "conversation"
  folderId: number
  conversationId: number | null
  runtimeConversationId?: number
  agentType: AgentType
  agentTypeProvisional?: boolean
  title: string
  isPinned: boolean
  workingDir?: string
  status?: ConversationStatus
}

export type TabItem = TabItemInternal

export interface TabContextValue {
  tabs: TabItem[]
  activeTabId: string | null
  activeTabActivationSeq: number
  tabsHydrated: boolean
  isTileMode: boolean
  tabPersistenceMode: TabPersistenceMode
  openTab: (
    folderId: number,
    conversationId: number,
    agentType: AgentType,
    pin?: boolean,
    title?: string
  ) => void
  closeTab: (tabId: string) => void
  closeConversationTab: (
    folderId: number,
    conversationId: number,
    agentType: AgentType
  ) => void
  closeOtherTabs: (tabId: string) => void
  closeAllTabs: () => void
  closeTabsByFolder: (folderId: number) => void
  switchTab: (tabId: string) => void
  pinTab: (tabId: string) => void
  toggleTileMode: () => void
  openNewConversationTab: (
    folderId: number,
    workingDir: string,
    options?: AgentType | { inheritFromActive?: boolean }
  ) => void
  confirmDraftAgent: (tabId: string, agentType: AgentType) => void
  setDraftAgentFromFallback: (tabId: string, agentType: AgentType) => void
  bindConversationTab: (
    tabId: string,
    conversationId: number,
    agentType: AgentType,
    title: string,
    runtimeConversationId?: number
  ) => void
  setTabRuntimeConversationId: (
    tabId: string,
    runtimeConversationId: number
  ) => void
  setTabFolder: (tabId: string, folderId: number, workingDir: string) => void
  reorderTabs: (reorderedTabs: TabItem[]) => void
  onPreviewTabReplaced: (callback: (tabId: string) => void) => () => void
}

export const TabContext = createContext<TabContextValue | null>(null)

export function useTabContext() {
  const ctx = useContext(TabContext)
  if (!ctx) {
    throw new Error("useTabContext must be used within TabProvider")
  }
  return ctx
}

export function makeConversationTabId(
  folderId: number,
  agentType: AgentType,
  conversationId: number
): string {
  return `conv-${folderId}-${agentType}-${conversationId}`
}

export function makeNewConversationTabId(): string {
  return `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function bumpActivationSeq(
  setActiveTabActivationSeq: Dispatch<SetStateAction<number>>
) {
  setActiveTabActivationSeq((prev) => prev + 1)
}

export function findTabIndexForConversation(
  tabs: TabItemInternal[],
  folderId: number,
  agentType: AgentType,
  conversationId: number
): number {
  const canonicalId = makeConversationTabId(folderId, agentType, conversationId)
  const idx = tabs.findIndex((t) => t.id === canonicalId)
  if (idx >= 0) return idx
  return tabs.findIndex(
    (t) =>
      t.folderId === folderId &&
      t.conversationId === conversationId &&
      t.agentType === agentType
  )
}

export type TabPersistenceMode = "shared" | "window-local"

export interface WindowLocalOpenedTab {
  id: string
  folder_id: number
  conversation_id: number | null
  runtime_conversation_id?: number
  agent_type: AgentType
  position: number
  is_active: boolean
  is_pinned: boolean
  working_dir?: string | null
}

export type WorkspaceBootstrapTarget =
  | {
      kind: "conversation"
      folderId: number
      conversationId: number
      agentType: AgentType
    }
  | {
      kind: "draft"
      folderId: number | null
      workingDir: string | null
      agentType: AgentType | null
    }
  | null

export interface WorkspaceBootstrapState {
  tabPersistenceMode: TabPersistenceMode
  target: WorkspaceBootstrapTarget
}

export const TAB_PERSISTENCE_QUERY_PARAM = "tabPersistence"
export const WINDOW_LOCAL_TAB_PERSISTENCE_MODE: TabPersistenceMode =
  "window-local"
export const WORKSPACE_BOOTSTRAP_QUERY_KEYS = [
  TAB_PERSISTENCE_QUERY_PARAM,
  "open",
  "folderId",
  "conversationId",
  "agent",
  "workingDir",
] as const
export const WINDOW_LOCAL_OPENED_TABS_STORAGE_KEY = "workspace:opened-tabs"

const REMEMBERED_TAB_PERSISTENCE_STORAGE_KEY = "workspace:tab-persistence-mode"
const CONSUMED_WORKSPACE_BOOTSTRAP_STORAGE_KEY = "workspace:bootstrap-consumed"

function toSearchParams(
  input: string | URLSearchParams | ReadonlyURLSearchParamsLike
): URLSearchParams {
  if (typeof input === "string") {
    const raw = input.startsWith("?") ? input.slice(1) : input
    return new URLSearchParams(raw)
  }
  return new URLSearchParams(input.toString())
}

function parseTabPersistenceMode(
  value: string | null | undefined
): TabPersistenceMode | null {
  if (value === "shared" || value === "window-local") {
    return value
  }
  return null
}

function parseNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeString(value: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeAgentType(value: string | null): AgentType | null {
  const normalized = normalizeString(value)
  if (!normalized) return null
  return ALL_AGENT_TYPES.includes(normalized as AgentType)
    ? (normalized as AgentType)
    : null
}

function getScopedBrowserStorage(mode: TabPersistenceMode): Storage | null {
  if (typeof window === "undefined") return null

  try {
    return mode === "window-local" ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

function readRememberedTabPersistenceMode(): TabPersistenceMode | null {
  if (typeof window === "undefined") return null

  try {
    return parseTabPersistenceMode(
      window.sessionStorage.getItem(REMEMBERED_TAB_PERSISTENCE_STORAGE_KEY)
    )
  } catch {
    return null
  }
}

export function resolveTabPersistenceMode(
  input: string | URLSearchParams | ReadonlyURLSearchParamsLike
): TabPersistenceMode {
  const params = toSearchParams(input)
  const explicitMode = parseTabPersistenceMode(
    params.get(TAB_PERSISTENCE_QUERY_PARAM)
  )
  if (explicitMode) {
    return explicitMode
  }
  return readRememberedTabPersistenceMode() ?? "shared"
}

export function rememberTabPersistenceMode(mode: TabPersistenceMode): void {
  if (typeof window === "undefined") return

  try {
    if (mode === "window-local") {
      window.sessionStorage.setItem(
        REMEMBERED_TAB_PERSISTENCE_STORAGE_KEY,
        mode
      )
      return
    }

    window.sessionStorage.removeItem(REMEMBERED_TAB_PERSISTENCE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function consumeWorkspaceBootstrap(search: string): void {
  if (typeof window === "undefined" || !hasWorkspaceBootstrapParams(search)) {
    return
  }

  try {
    window.sessionStorage.setItem(
      CONSUMED_WORKSPACE_BOOTSTRAP_STORAGE_KEY,
      search
    )
    window.history.replaceState(
      {},
      "",
      buildWorkspaceUrlAfterBootstrap(window.location.pathname, search)
    )
  } catch {
    /* ignore */
  }
}

export function hasConsumedWorkspaceBootstrap(search: string): boolean {
  if (typeof window === "undefined") return false

  try {
    return (
      window.sessionStorage.getItem(
        CONSUMED_WORKSPACE_BOOTSTRAP_STORAGE_KEY
      ) === search
    )
  } catch {
    return false
  }
}

export function hasAnyConsumedWorkspaceBootstrap(): boolean {
  if (typeof window === "undefined") return false

  try {
    return Boolean(
      window.sessionStorage.getItem(CONSUMED_WORKSPACE_BOOTSTRAP_STORAGE_KEY)
    )
  } catch {
    return false
  }
}

export function readScopedStorageItem(
  mode: TabPersistenceMode,
  key: string
): string | null {
  return getScopedBrowserStorage(mode)?.getItem(key) ?? null
}

export function writeScopedStorageItem(
  mode: TabPersistenceMode,
  key: string,
  value: string
): void {
  try {
    getScopedBrowserStorage(mode)?.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function removeScopedStorageItem(
  mode: TabPersistenceMode,
  key: string
): void {
  try {
    getScopedBrowserStorage(mode)?.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function parseWorkspaceBootstrap(
  input: string | URLSearchParams | ReadonlyURLSearchParamsLike
): WorkspaceBootstrapState {
  const params = toSearchParams(input)
  const tabPersistenceMode = resolveTabPersistenceMode(params)
  const openTarget = normalizeString(params.get("open"))
  const folderId = parseNumber(params.get("folderId"))
  const conversationId = parseNumber(params.get("conversationId"))
  const agentType = normalizeAgentType(params.get("agent"))
  const workingDir = normalizeString(params.get("workingDir"))

  if (
    (openTarget === "conversation" ||
      (openTarget == null && conversationId != null)) &&
    folderId != null &&
    conversationId != null &&
    agentType != null
  ) {
    return {
      tabPersistenceMode,
      target: {
        kind: "conversation",
        folderId,
        conversationId,
        agentType,
      },
    }
  }

  if (openTarget === "draft") {
    return {
      tabPersistenceMode,
      target: {
        kind: "draft",
        folderId,
        workingDir,
        agentType,
      },
    }
  }

  return {
    tabPersistenceMode,
    target: null,
  }
}

export function hasWorkspaceBootstrapParams(
  input: string | URLSearchParams | ReadonlyURLSearchParamsLike
): boolean {
  const params = toSearchParams(input)
  return WORKSPACE_BOOTSTRAP_QUERY_KEYS.some((key) => params.has(key))
}

export function buildWorkspaceUrlAfterBootstrap(
  pathname: string,
  input: string | URLSearchParams | ReadonlyURLSearchParamsLike
): string {
  const params = toSearchParams(input)
  for (const key of WORKSPACE_BOOTSTRAP_QUERY_KEYS) {
    params.delete(key)
  }
  const search = params.toString()
  return search ? `${pathname}?${search}` : pathname
}

export function buildWorkspaceBootstrapUrl(
  target: WorkspaceBootstrapTarget
): string {
  const params = new URLSearchParams()
  params.set(TAB_PERSISTENCE_QUERY_PARAM, WINDOW_LOCAL_TAB_PERSISTENCE_MODE)

  if (target?.kind === "conversation") {
    params.set("open", "conversation")
    params.set("folderId", String(target.folderId))
    params.set("conversationId", String(target.conversationId))
    params.set("agent", target.agentType)
  } else if (target?.kind === "draft") {
    params.set("open", "draft")
    if (target.folderId != null) {
      params.set("folderId", String(target.folderId))
    }
    if (target.workingDir) {
      params.set("workingDir", target.workingDir)
    }
    if (target.agentType) {
      params.set("agent", target.agentType)
    }
  }

  const search = params.toString()
  return search ? `/workspace?${search}` : "/workspace"
}

interface ReadonlyURLSearchParamsLike {
  toString(): string
}
