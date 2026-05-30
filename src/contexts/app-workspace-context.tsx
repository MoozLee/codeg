"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  getGitBranch,
  listAllConversations,
  listAllFolderDetails,
  listOpenFolderDetails,
  openFolder as apiOpenFolder,
  openFolderById as apiOpenFolderById,
  removeFolderFromWorkspace as apiRemoveFolderFromWorkspace,
  reorderFolders as apiReorderFolders,
  getFolder as apiGetFolder,
  updateFolderPinned as apiUpdateFolderPinned,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { useAcpEvent } from "@/contexts/acp-connections-context"
import type {
  AgentStats,
  AgentType,
  DbConversationSummary,
  EventEnvelope,
  FolderDetail,
} from "@/lib/types"

interface ConversationSummaryLocalSync {
  id: number
  folderId?: number
  agentType?: AgentType
  title?: string | null
  status?: DbConversationSummary["status"]
  model?: string | null
  gitBranch?: string | null
  externalId?: string | null
  messageCount?: number
  createdAt?: string
  updatedAt?: string
}

interface AppWorkspaceContextValue {
  folders: FolderDetail[]
  allFolders: FolderDetail[]
  foldersHydrated: boolean
  foldersLoading: boolean
  getFolder: (id: number) => FolderDetail | undefined

  conversations: DbConversationSummary[]
  conversationsLoading: boolean
  conversationsError: string | null
  refreshConversations: () => Promise<void>
  updateConversationLocal: (
    id: number,
    patch: Partial<Pick<DbConversationSummary, "status" | "title">>
  ) => void
  syncConversationSummaryLocal: (sync: ConversationSummaryLocalSync) => void

  branches: Map<number, string | null>
  getBranch: (folderId: number) => string | null | undefined
  setBranch: (folderId: number, branch: string | null) => void

  upsertFolder: (detail: FolderDetail) => void
  openFolder: (path: string) => Promise<FolderDetail>
  addFolderToWorkspaceById: (folderId: number) => Promise<FolderDetail>
  removeFolderFromWorkspace: (folderId: number) => Promise<void>
  reorderFolders: (ids: number[]) => Promise<void>
  togglePinFolder: (folderId: number) => Promise<void>
  refreshFolder: (id: number) => Promise<void>
  refreshFolders: () => Promise<void>

  stats: AgentStats | null

  /**
   * Currently-active folder id as driven by the active tab.
   * TabProvider sets this; ActiveFolderProvider / other consumers read it.
   */
  activeFolderId: number | null
  setActiveFolderId: (id: number | null) => void
}

const AppWorkspaceContext = createContext<AppWorkspaceContextValue | null>(null)

export function useAppWorkspace() {
  const ctx = useContext(AppWorkspaceContext)
  if (!ctx) {
    throw new Error("useAppWorkspace must be used within AppWorkspaceProvider")
  }
  return ctx
}

function computeStats(conversations: DbConversationSummary[]): AgentStats {
  const byAgent = new Map<AgentType, number>()
  let totalMessages = 0

  for (const s of conversations) {
    byAgent.set(s.agent_type, (byAgent.get(s.agent_type) ?? 0) + 1)
    totalMessages += s.message_count
  }

  return {
    total_conversations: conversations.length,
    total_messages: totalMessages,
    by_agent: Array.from(byAgent.entries()).map(([agent_type, count]) => ({
      agent_type,
      conversation_count: count,
    })),
  }
}

interface AppWorkspaceProviderProps {
  children: ReactNode
}

export function AppWorkspaceProvider({ children }: AppWorkspaceProviderProps) {
  const [folders, setFolders] = useState<FolderDetail[]>([])
  const [allFolders, setAllFolders] = useState<FolderDetail[]>([])
  const [foldersHydrated, setFoldersHydrated] = useState(false)
  const [foldersLoading, setFoldersLoading] = useState(true)

  const [conversations, setConversations] = useState<DbConversationSummary[]>(
    []
  )
  const [conversationsLoading, setConversationsLoading] = useState(true)
  const [conversationsError, setConversationsError] = useState<string | null>(
    null
  )

  const [branches, setBranches] = useState<Map<number, string | null>>(
    new Map()
  )
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchFolders = useCallback(async () => {
    setFoldersLoading(true)
    try {
      const [openList, allList] = await Promise.all([
        listOpenFolderDetails(),
        listAllFolderDetails(),
      ])
      if (!mountedRef.current) return
      setFolders(openList)
      setAllFolders(allList)
      setBranches((prev) => {
        const next = new Map(prev)
        for (const f of allList) {
          if (!next.has(f.id)) {
            next.set(f.id, f.git_branch ?? null)
          }
        }
        return next
      })
    } catch (err) {
      console.error("[AppWorkspace] fetchFolders failed:", err)
    } finally {
      if (mountedRef.current) {
        setFoldersLoading(false)
        setFoldersHydrated(true)
      }
    }
  }, [])

  const refreshConversations = useCallback(async (): Promise<void> => {
    setConversationsLoading(true)
    try {
      const list = await listAllConversations()
      if (!mountedRef.current) return
      setConversations(list)
      setConversationsError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setConversationsError(toErrorMessage(err))
    } finally {
      if (mountedRef.current) {
        setConversationsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void fetchFolders()
    void refreshConversations()
  }, [fetchFolders, refreshConversations])

  const getFolder = useCallback(
    (id: number) => allFolders.find((f) => f.id === id),
    [allFolders]
  )

  const syncConversationSummaryLocal = useCallback(
    ({
      id,
      folderId,
      agentType,
      title,
      status,
      model,
      gitBranch,
      externalId,
      messageCount,
      createdAt,
      updatedAt,
    }: ConversationSummaryLocalSync) => {
      setConversations((prev) => {
        const now = new Date().toISOString()
        const nextUpdatedAt = updatedAt ?? now
        const existingIndex = prev.findIndex(
          (conversation) => conversation.id === id
        )

        if (existingIndex >= 0) {
          const existing = prev[existingIndex]
          const nextMessageCount =
            messageCount !== undefined
              ? Math.max(existing.message_count, messageCount)
              : existing.message_count
          const nextConversation: DbConversationSummary = {
            ...existing,
            ...(folderId != null ? { folder_id: folderId } : {}),
            ...(agentType ? { agent_type: agentType } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(status ? { status } : {}),
            ...(model !== undefined ? { model } : {}),
            ...(gitBranch !== undefined ? { git_branch: gitBranch } : {}),
            ...(externalId !== undefined ? { external_id: externalId } : {}),
            message_count: nextMessageCount,
            updated_at: nextUpdatedAt,
          }

          const changed =
            nextConversation.folder_id !== existing.folder_id ||
            nextConversation.agent_type !== existing.agent_type ||
            nextConversation.title !== existing.title ||
            nextConversation.status !== existing.status ||
            nextConversation.model !== existing.model ||
            nextConversation.git_branch !== existing.git_branch ||
            nextConversation.external_id !== existing.external_id ||
            nextConversation.message_count !== existing.message_count ||
            nextConversation.updated_at !== existing.updated_at

          if (!changed) {
            return prev
          }

          const next = [...prev]
          next[existingIndex] = nextConversation
          return next
        }

        if (folderId == null || !agentType) {
          return prev
        }

        const newConversation: DbConversationSummary = {
          id,
          folder_id: folderId,
          title: title ?? null,
          agent_type: agentType,
          status: status ?? "in_progress",
          model: model ?? null,
          git_branch: gitBranch ?? null,
          external_id: externalId ?? null,
          message_count: messageCount ?? 0,
          created_at: createdAt ?? nextUpdatedAt,
          updated_at: nextUpdatedAt,
        }

        return [...prev, newConversation]
      })
    },
    []
  )

  const updateConversationLocal = useCallback(
    (
      id: number,
      patch: Partial<Pick<DbConversationSummary, "status" | "title">>
    ) => {
      syncConversationSummaryLocal({ id, ...patch })
    },
    [syncConversationSummaryLocal]
  )

  const getBranch = useCallback(
    (folderId: number) => branches.get(folderId),
    [branches]
  )

  const setBranch = useCallback((folderId: number, branch: string | null) => {
    setBranches((prev) => {
      const next = new Map(prev)
      next.set(folderId, branch)
      return next
    })
  }, [])

  const upsertFolder = useCallback((detail: FolderDetail) => {
    const upsert = (prev: FolderDetail[]) => {
      const idx = prev.findIndex((f) => f.id === detail.id)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = detail
        return updated
      }
      return [...prev, detail]
    }
    setFolders(upsert)
    setAllFolders(upsert)
  }, [])

  const openFolder = useCallback(
    async (path: string) => {
      const detail = await apiOpenFolder(path)
      upsertFolder(detail)
      setBranches((prev) => {
        const next = new Map(prev)
        next.set(detail.id, detail.git_branch ?? null)
        return next
      })
      void refreshConversations()
      return detail
    },
    [refreshConversations, upsertFolder]
  )

  const addFolderToWorkspaceById = useCallback(
    async (folderId: number) => {
      const detail = await apiOpenFolderById(folderId)
      upsertFolder(detail)
      setBranches((prev) => {
        const next = new Map(prev)
        next.set(detail.id, detail.git_branch ?? null)
        return next
      })
      void refreshConversations()
      return detail
    },
    [refreshConversations, upsertFolder]
  )

  const removeFolderFromWorkspace = useCallback(
    async (folderId: number) => {
      await apiRemoveFolderFromWorkspace(folderId)
      setFolders((prev) => prev.filter((f) => f.id !== folderId))
      setBranches((prev) => {
        if (!prev.has(folderId)) return prev
        const next = new Map(prev)
        next.delete(folderId)
        return next
      })
      void refreshConversations()
    },
    [refreshConversations]
  )

  const reorderFolders = useCallback(async (ids: number[]) => {
    let prevFoldersSnapshot: FolderDetail[] | null = null
    let prevAllFoldersSnapshot: FolderDetail[] | null = null

    const reorderByIds = (prev: FolderDetail[]) => {
      const byId = new Map(prev.map((f) => [f.id, f]))
      const next: FolderDetail[] = []
      ids.forEach((id, idx) => {
        const folder = byId.get(id)
        if (folder) {
          next.push({ ...folder, sort_order: idx + 1 })
          byId.delete(id)
        }
      })
      // Keep folders not included in `ids` at the end, preserving relative order.
      for (const f of prev) {
        if (byId.has(f.id)) next.push(f)
      }
      return next
    }

    setFolders((prev) => {
      prevFoldersSnapshot = prev
      return reorderByIds(prev)
    })
    setAllFolders((prev) => {
      prevAllFoldersSnapshot = prev
      return reorderByIds(prev)
    })

    try {
      await apiReorderFolders(ids)
    } catch (err) {
      if (prevFoldersSnapshot) setFolders(prevFoldersSnapshot)
      if (prevAllFoldersSnapshot) setAllFolders(prevAllFoldersSnapshot)
      throw err
    }
  }, [])

  const refreshFolder = useCallback(async (id: number) => {
    try {
      const detail = await apiGetFolder(id)
      const patch = (prev: FolderDetail[]) => {
        const idx = prev.findIndex((f) => f.id === id)
        if (idx < 0) return prev
        const updated = [...prev]
        updated[idx] = detail
        return updated
      }
      setFolders(patch)
      setAllFolders(patch)
      setBranches((prev) => {
        const next = new Map(prev)
        next.set(id, detail.git_branch ?? null)
        return next
      })
    } catch (err) {
      console.error("[AppWorkspace] refreshFolder failed:", err)
    }
  }, [])

  const refreshFolders = useCallback(async () => {
    await fetchFolders()
  }, [fetchFolders])

  const togglePinFolder = useCallback(
    async (folderId: number) => {
      // Look up the current pin state from either list (folders is the open
      // list, allFolders is the full list) before flipping it on the server.
      const existing =
        folders.find((f) => f.id === folderId) ??
        allFolders.find((f) => f.id === folderId)
      if (!existing) return
      const nextPinned = !existing.is_pinned
      try {
        await apiUpdateFolderPinned(folderId, nextPinned)
        // Reload ordering from the backend so both sections reflect the
        // canonical sort_order after the transactional top-insert.
        await fetchFolders()
      } catch (err) {
        console.error("[AppWorkspace] togglePinFolder failed:", err)
        throw err
      }
    },
    [folders, allFolders, fetchFolders]
  )

  // Branch polling: only poll the active folder.
  useEffect(() => {
    if (activeFolderId == null) return
    const folderId = activeFolderId
    const folder = allFolders.find((f) => f.id === folderId)
    if (!folder) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const branch = await getGitBranch(folder.path)
        if (cancelled) return
        setBranches((prev) => {
          const existing = prev.get(folderId)
          if (existing === branch) return prev
          const next = new Map(prev)
          next.set(folderId, branch)
          return next
        })
        const delay = branch ? 10_000 : 60_000
        timer = setTimeout(poll, delay)
      } catch {
        if (!cancelled) {
          timer = setTimeout(poll, 60_000)
        }
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [activeFolderId, allFolders])

  const stats = useMemo(
    () => (conversations.length > 0 ? computeStats(conversations) : null),
    [conversations]
  )

  const value = useMemo<AppWorkspaceContextValue>(
    () => ({
      folders,
      allFolders,
      foldersHydrated,
      foldersLoading,
      getFolder,
      conversations,
      conversationsLoading,
      conversationsError,
      refreshConversations,
      updateConversationLocal,
      syncConversationSummaryLocal,
      branches,
      getBranch,
      setBranch,
      upsertFolder,
      openFolder,
      addFolderToWorkspaceById,
      removeFolderFromWorkspace,
      reorderFolders,
      togglePinFolder,
      refreshFolder,
      refreshFolders,
      stats,
      activeFolderId,
      setActiveFolderId,
    }),
    [
      folders,
      allFolders,
      foldersHydrated,
      foldersLoading,
      getFolder,
      conversations,
      conversationsLoading,
      conversationsError,
      refreshConversations,
      updateConversationLocal,
      syncConversationSummaryLocal,
      branches,
      getBranch,
      setBranch,
      upsertFolder,
      openFolder,
      addFolderToWorkspaceById,
      removeFolderFromWorkspace,
      reorderFolders,
      togglePinFolder,
      refreshFolder,
      refreshFolders,
      stats,
      activeFolderId,
    ]
  )

  return (
    <AppWorkspaceContext.Provider value={value}>
      {children}
    </AppWorkspaceContext.Provider>
  )
}

/**
 * Bridges backend `conversation_status_changed` events into the workspace's
 * local conversations list. The DB row is already updated by the backend
 * before this event fires, so this only patches the in-memory summary.
 *
 * Must be rendered inside both `AppWorkspaceProvider` (for
 * `useAppWorkspace`) and `AcpConnectionsProvider` (for `useAcpEvent`).
 */
export function ConversationStatusEventBridge() {
  const { syncConversationSummaryLocal, updateConversationLocal } =
    useAppWorkspace()
  useAcpEvent((envelope: EventEnvelope) => {
    switch (envelope.type) {
      case "conversation_linked":
        syncConversationSummaryLocal({
          id: envelope.conversation_id,
          folderId: envelope.folder_id,
          status: "in_progress",
        })
        return
      case "conversation_status_changed":
        updateConversationLocal(envelope.conversation_id, {
          status: envelope.status,
        })
        return
      default:
        return
    }
  })
  return null
}
