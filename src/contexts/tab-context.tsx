"use client"

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
  type SetStateAction,
} from "react"
import { useTranslations } from "next-intl"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import { useAcpActions } from "@/contexts/acp-connections-context"
import {
  TabContext,
  bumpActivationSeq,
  consumeWorkspaceBootstrap,
  findTabIndexForConversation,
  makeConversationTabId,
  makeNewConversationTabId,
  readScopedStorageItem,
  removeScopedStorageItem,
  useTabContext,
  WINDOW_LOCAL_OPENED_TABS_STORAGE_KEY,
  writeScopedStorageItem,
  type TabContextValue,
  type TabItem,
  type TabItemInternal,
  type TabPersistenceMode,
  type WindowLocalOpenedTab,
  type WorkspaceBootstrapState,
} from "@/contexts/tab-shared"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useSortedAvailableAgents } from "@/hooks/use-sorted-available-agents"
import {
  listOpenedTabs,
  saveOpenedTabs,
  syncConversationWindowOwnership,
} from "@/lib/api"
import { resolveDefaultAgent } from "@/lib/resolve-default-agent"
import type { AgentType, ConversationStatus, OpenedTab } from "@/lib/types"
import { AGENT_DISPLAY_ORDER } from "@/lib/types"

export { useTabContext }
export type { TabItem }

interface TabProviderProps {
  children: ReactNode
  persistenceMode?: TabPersistenceMode
  bootstrapState?: WorkspaceBootstrapState
}

interface DraftRetargetRequest {
  tabId: string
  expectedAgent: AgentType
  folderId: number
  workingDir: string
  agentType: AgentType
  provisional: boolean
}

interface TabState {
  rawTabs: TabItemInternal[]
  activeTabId: string | null
  previewReplacedTabIds: string[]
  draftRetargetRequests: DraftRetargetRequest[]
}

const TILE_MODE_STORAGE_KEY = "workspace:tile-mode"

function serializeWindowLocalTabs(
  tabs: TabItemInternal[],
  activeTabId: string | null
): WindowLocalOpenedTab[] {
  return tabs.map((tab, index) => ({
    id: tab.id,
    folder_id: tab.folderId,
    conversation_id: tab.conversationId,
    runtime_conversation_id: tab.runtimeConversationId,
    agent_type: tab.agentType,
    position: index,
    is_active: tab.id === activeTabId,
    is_pinned: tab.isPinned,
    working_dir: tab.workingDir ?? null,
  }))
}

function restoreWindowLocalTabs(
  items: WindowLocalOpenedTab[],
  t: ReturnType<typeof useTranslations>
): TabItemInternal[] {
  return items
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      id:
        typeof item.id === "string" && item.id.length > 0
          ? item.id
          : item.conversation_id != null
            ? makeConversationTabId(
                item.folder_id,
                item.agent_type,
                item.conversation_id
              )
            : makeNewConversationTabId(),
      kind: "conversation",
      folderId: item.folder_id,
      conversationId: item.conversation_id,
      runtimeConversationId:
        typeof item.runtime_conversation_id === "number"
          ? item.runtime_conversation_id
          : undefined,
      agentType: item.agent_type,
      title:
        item.conversation_id != null
          ? t("loadingConversation")
          : t("newConversation"),
      isPinned: item.is_pinned,
      workingDir: item.working_dir ?? undefined,
    }))
}

export function TabProvider({
  children,
  persistenceMode = "shared",
  bootstrapState,
}: TabProviderProps) {
  const t = useTranslations("Folder.tabContext")
  const { activateConversationPane } = useWorkspaceContext()
  const { conversations, folders, foldersHydrated, setActiveFolderId } =
    useAppWorkspace()
  const { disconnect: acpDisconnect } = useAcpActions()

  const [tabState, setTabState] = useState<TabState>({
    rawTabs: [],
    activeTabId: null,
    previewReplacedTabIds: [],
    draftRetargetRequests: [],
  })
  const { rawTabs, activeTabId, previewReplacedTabIds, draftRetargetRequests } =
    tabState
  const [activeTabActivationSeq, setActiveTabActivationSeq] = useState(0)
  const [tabsHydrated, setTabsHydrated] = useState(false)

  const setTabs = useCallback((action: SetStateAction<TabItemInternal[]>) => {
    setTabState((prev) => {
      const nextRawTabs =
        typeof action === "function" ? action(prev.rawTabs) : action
      if (nextRawTabs === prev.rawTabs) return prev
      return { ...prev, rawTabs: nextRawTabs }
    })
  }, [])

  const setActiveTabId = useCallback(
    (action: SetStateAction<string | null>) => {
      setTabState((prev) => {
        const nextActiveTabId =
          typeof action === "function" ? action(prev.activeTabId) : action
        if (nextActiveTabId === prev.activeTabId) return prev
        return { ...prev, activeTabId: nextActiveTabId }
      })
    },
    []
  )

  // Refs for volatile state
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const previousActiveTabIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (previousActiveTabIdRef.current === activeTabId) return
    previousActiveTabIdRef.current = activeTabId
    if (activeTabId == null) return
    bumpActivationSeq(setActiveTabActivationSeq)
  }, [activeTabId])

  const rawTabsRef = useRef(rawTabs)
  useEffect(() => {
    rawTabsRef.current = rawTabs
  }, [rawTabs])

  useEffect(() => {
    const conversationIds = Array.from(
      new Set(
        rawTabs
          .map((tab) => tab.conversationId)
          .filter(
            (conversationId): conversationId is number => conversationId != null
          )
      )
    )
    void syncConversationWindowOwnership(conversationIds)
  }, [rawTabs])

  useEffect(() => {
    const activeTab = rawTabs.find((t) => t.id === activeTabId) ?? null
    setActiveFolderId(activeTab?.folderId ?? null)
  }, [rawTabs, activeTabId, setActiveFolderId])

  const conversationsRef = useRef(conversations)
  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  const foldersRef = useRef(folders)
  useEffect(() => {
    foldersRef.current = folders
  }, [folders])

  // ACP agent list driven by the shared hook. `sortedTypes` reflects the
  // user-defined drag-sort order (filtered to enabled+available) and is
  // seeded from localStorage for synchronous cold-start use. `fresh`
  // flips true after the first successful `acpListAgents()` call this
  // session and stays true thereafter — used to gate provisional default
  // assignment and the correction effect below.
  const { sortedTypes: sortedAvailableAgents, fresh: agentsFresh } =
    useSortedAvailableAgents()

  const sortedAvailableAgentsRef = useRef<AgentType[]>(sortedAvailableAgents)
  useEffect(() => {
    sortedAvailableAgentsRef.current = sortedAvailableAgents
  }, [sortedAvailableAgents])

  const agentsFreshRef = useRef(agentsFresh)
  useEffect(() => {
    agentsFreshRef.current = agentsFresh
  }, [agentsFresh])

  // Pick the agent + provisional flag for a new draft tab. Wraps the
  // pure `resolveDefaultAgent` helper with TabProvider-scoped lookups
  // (folder default, latest sorted types, fresh flag). Reads via refs so
  // callbacks don't need to depend on the state values.
  const resolveAgentForFolder = useCallback(
    (
      folderId: number,
      inherit: AgentType | null
    ): { agentType: AgentType; provisional: boolean } => {
      const folderDefault =
        foldersRef.current.find((f) => f.id === folderId)?.default_agent_type ??
        null
      return resolveDefaultAgent({
        folderDefault,
        inherit,
        sortedTypes: sortedAvailableAgentsRef.current,
        fresh: agentsFreshRef.current,
      })
    },
    []
  )

  // Callback set for preview tab replacement notifications
  const previewReplacedCallbacksRef = useRef(new Set<(tabId: string) => void>())
  const onPreviewTabReplaced = useCallback(
    (callback: (tabId: string) => void) => {
      previewReplacedCallbacksRef.current.add(callback)
      return () => {
        previewReplacedCallbacksRef.current.delete(callback)
      }
    },
    []
  )

  useEffect(() => {
    if (previewReplacedTabIds.length === 0) return

    const consumedIds = previewReplacedTabIds
    for (const tabId of consumedIds) {
      for (const cb of previewReplacedCallbacksRef.current) {
        cb(tabId)
      }
    }

    setTabState((prev) => {
      const matchesPrefix = consumedIds.every(
        (tabId, index) => prev.previewReplacedTabIds[index] === tabId
      )
      if (!matchesPrefix) return prev
      return {
        ...prev,
        previewReplacedTabIds: prev.previewReplacedTabIds.slice(
          consumedIds.length
        ),
      }
    })
  }, [previewReplacedTabIds])

  useEffect(() => {
    if (draftRetargetRequests.length === 0) return

    const consumedRequests = draftRetargetRequests
    setTabState((prev) => {
      const matchesPrefix = consumedRequests.every(
        (request, index) => prev.draftRetargetRequests[index] === request
      )
      if (!matchesPrefix) return prev
      return {
        ...prev,
        draftRetargetRequests: prev.draftRetargetRequests.slice(
          consumedRequests.length
        ),
      }
    })

    for (const request of consumedRequests) {
      void (async () => {
        try {
          await acpDisconnect(request.tabId)
        } catch (err) {
          console.error("[TabProvider] disconnect draft tab:", err)
        }

        setTabState((prev) => {
          const target = prev.rawTabs.find((tab) => tab.id === request.tabId)
          if (!target) return prev
          if (target.conversationId != null) return prev
          if (
            target.agentType !== request.expectedAgent &&
            !target.agentTypeProvisional
          ) {
            return prev
          }

          return {
            ...prev,
            rawTabs: prev.rawTabs.map((tab) =>
              tab.id === request.tabId
                ? {
                    ...tab,
                    folderId: request.folderId,
                    workingDir: request.workingDir,
                    agentType: request.agentType,
                    agentTypeProvisional: request.provisional,
                  }
                : tab
            ),
          }
        })
      })()
    }
  }, [acpDisconnect, draftRetargetRequests])

  // Hydrate from persisted opened_tabs on mount
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (persistenceMode === "window-local") {
          const raw = readScopedStorageItem(
            persistenceMode,
            WINDOW_LOCAL_OPENED_TABS_STORAGE_KEY
          )
          if (!cancelled && raw) {
            const parsed = JSON.parse(raw) as WindowLocalOpenedTab[]
            const restored = restoreWindowLocalTabs(parsed, t)
            if (restored.length > 0) {
              setTabs(restored)
              const active = parsed.find((item) => item.is_active)
              if (active) {
                const activeRestored = restored.find(
                  (tab) => tab.id === active.id
                )
                if (activeRestored) {
                  setActiveTabId(activeRestored.id)
                }
              } else {
                setActiveTabId(restored[0].id)
              }
              return
            }
          }

          if (!cancelled && bootstrapState?.target) {
            consumeWorkspaceBootstrap(window.location.search)
            const initialTab: TabItemInternal =
              bootstrapState.target.kind === "conversation"
                ? {
                    id: makeConversationTabId(
                      bootstrapState.target.folderId,
                      bootstrapState.target.agentType,
                      bootstrapState.target.conversationId
                    ),
                    kind: "conversation",
                    folderId: bootstrapState.target.folderId,
                    conversationId: bootstrapState.target.conversationId,
                    agentType: bootstrapState.target.agentType,
                    title: t("loadingConversation"),
                    isPinned: true,
                  }
                : {
                    id: makeNewConversationTabId(),
                    kind: "conversation",
                    folderId: bootstrapState.target.folderId ?? 0,
                    conversationId: null,
                    agentType:
                      bootstrapState.target.agentType ?? AGENT_DISPLAY_ORDER[0],
                    title: t("newConversation"),
                    isPinned: true,
                    workingDir: bootstrapState.target.workingDir ?? undefined,
                  }

            setTabs([initialTab])
            setActiveTabId(initialTab.id)
          }
          return
        }

        const items = await listOpenedTabs()
        if (cancelled) return
        const restored: TabItemInternal[] = items.map((it) => ({
          id:
            it.conversation_id != null
              ? makeConversationTabId(
                  it.folder_id,
                  it.agent_type,
                  it.conversation_id
                )
              : makeNewConversationTabId(),
          kind: "conversation",
          folderId: it.folder_id,
          conversationId: it.conversation_id,
          agentType: it.agent_type,
          title:
            it.conversation_id != null
              ? t("loadingConversation")
              : t("newConversation"),
          isPinned: it.is_pinned,
        }))
        setTabs(restored)
        const active = items.find((it) => it.is_active)
        if (active) {
          const activeRestored = restored.find(
            (r) =>
              r.folderId === active.folder_id &&
              r.agentType === active.agent_type &&
              r.conversationId === active.conversation_id
          )
          if (activeRestored) setActiveTabId(activeRestored.id)
        } else if (restored.length > 0) {
          setActiveTabId(restored[0].id)
        }
      } catch (err) {
        console.error("[TabProvider] hydrate tabs failed:", err)
      } finally {
        if (!cancelled) setTabsHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootstrapState?.target, persistenceMode, setActiveTabId, setTabs, t])

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!tabsHydrated) return

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
      if (persistenceMode === "window-local") {
        if (rawTabs.length === 0) {
          removeScopedStorageItem(
            persistenceMode,
            WINDOW_LOCAL_OPENED_TABS_STORAGE_KEY
          )
          return
        }

        writeScopedStorageItem(
          persistenceMode,
          WINDOW_LOCAL_OPENED_TABS_STORAGE_KEY,
          JSON.stringify(serializeWindowLocalTabs(rawTabs, activeTabId))
        )
        return
      }

      const items: OpenedTab[] = rawTabs.map((tab, i) => ({
        id: 0,
        folder_id: tab.folderId,
        conversation_id: tab.conversationId,
        agent_type: tab.agentType,
        position: i,
        is_active: tab.id === activeTabId,
        is_pinned: tab.isPinned,
      }))

      saveOpenedTabs(items).catch(() => {
        // Silently ignore save errors
      })
    }, 500)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [rawTabs, activeTabId, persistenceMode, tabsHydrated])

  const conversationMap = useMemo(() => {
    const m = new Map<string, (typeof conversations)[number]>()
    for (const c of conversations) {
      m.set(`${c.folder_id}-${c.agent_type}-${c.id}`, c)
    }
    return m
  }, [conversations])

  const tabs = useMemo(() => {
    if (conversationMap.size === 0) return rawTabs
    return rawTabs.map((tab) => {
      if (tab.conversationId != null) {
        const conv = conversationMap.get(
          `${tab.folderId}-${tab.agentType}-${tab.conversationId}`
        )
        if (conv) {
          const newTitle = conv.title || t("untitledConversation")
          const newStatus = conv.status as ConversationStatus | undefined
          if (tab.title !== newTitle || tab.status !== newStatus) {
            return { ...tab, title: newTitle, status: newStatus }
          }
        }
      }
      return tab
    })
  }, [rawTabs, conversationMap, t])

  const openTab = useCallback(
    (
      folderId: number,
      conversationId: number,
      agentType: AgentType,
      pin = false,
      title?: string
    ) => {
      setTabState((prevState) => {
        const existingIndex = findTabIndexForConversation(
          prevState.rawTabs,
          folderId,
          agentType,
          conversationId
        )

        if (existingIndex >= 0) {
          const activateTabId = prevState.rawTabs[existingIndex].id
          if (pin && !prevState.rawTabs[existingIndex].isPinned) {
            const updated = [...prevState.rawTabs]
            updated[existingIndex] = {
              ...updated[existingIndex],
              isPinned: true,
            }
            return {
              ...prevState,
              rawTabs: updated,
              activeTabId: activateTabId,
            }
          }
          return { ...prevState, activeTabId: activateTabId }
        }

        const resolvedTitle =
          title ??
          conversationsRef.current.find(
            (c) =>
              c.id === conversationId &&
              c.agent_type === agentType &&
              c.folder_id === folderId
          )?.title ??
          t("untitledConversation")

        const tabId = makeConversationTabId(folderId, agentType, conversationId)
        const newTab: TabItemInternal = {
          id: tabId,
          kind: "conversation",
          folderId,
          conversationId,
          agentType,
          title: resolvedTitle,
          isPinned: pin,
        }

        if (pin) {
          return {
            ...prevState,
            rawTabs: [...prevState.rawTabs, newTab],
            activeTabId: tabId,
          }
        }

        const previewIndex = prevState.rawTabs.findIndex((t) => !t.isPinned)
        if (previewIndex >= 0) {
          const updated = [...prevState.rawTabs]
          const replacedPreviewTabId = updated[previewIndex].id
          updated[previewIndex] = newTab
          return {
            ...prevState,
            rawTabs: updated,
            activeTabId: tabId,
            previewReplacedTabIds: [
              ...prevState.previewReplacedTabIds,
              replacedPreviewTabId,
            ],
          }
        }

        return {
          ...prevState,
          rawTabs: [...prevState.rawTabs, newTab],
          activeTabId: tabId,
        }
      })

      activateConversationPane()
    },
    [activateConversationPane, t]
  )

  const makeReplacementDraftTab = useCallback(
    (preferred?: TabItemInternal): TabItemInternal => {
      const folderId = preferred?.folderId ?? foldersRef.current[0]?.id ?? 0
      const workingDir =
        preferred?.workingDir ??
        foldersRef.current.find((f) => f.id === folderId)?.path ??
        ""
      // If we have a preferred (closing) tab, inherit BOTH its agent and
      // its provisional flag — we should not silently launder a system
      // best-guess into a confirmed value just because the source tab was
      // closed. Otherwise resolve from scratch.
      const { agentType, provisional } = preferred?.agentType
        ? {
            agentType: preferred.agentType,
            provisional: preferred.agentTypeProvisional ?? false,
          }
        : resolveAgentForFolder(folderId, null)
      return {
        id: makeNewConversationTabId(),
        kind: "conversation",
        folderId,
        conversationId: null,
        agentType,
        title: t("newConversation"),
        isPinned: true,
        workingDir,
        agentTypeProvisional: provisional,
      }
    },
    [resolveAgentForFolder, t]
  )

  const [isTileMode, setIsTileMode] = useState(() => {
    return (
      readScopedStorageItem(persistenceMode, TILE_MODE_STORAGE_KEY) === "true"
    )
  })

  useEffect(() => {
    writeScopedStorageItem(
      persistenceMode,
      TILE_MODE_STORAGE_KEY,
      String(isTileMode)
    )
  }, [isTileMode, persistenceMode])

  const closeTab = useCallback(
    (tabId: string) => {
      const shouldActivateConversation = tabId === activeTabIdRef.current

      setTabState((prevState) => {
        const index = prevState.rawTabs.findIndex((t) => t.id === tabId)
        if (index < 0) return prevState

        const closingTab = prevState.rawTabs[index]
        const next = prevState.rawTabs.filter((t) => t.id !== tabId)

        if (next.length === 0) {
          if (
            persistenceMode === "window-local" ||
            foldersRef.current.length === 0
          ) {
            return { ...prevState, rawTabs: [], activeTabId: null }
          }
          const replacementTab = makeReplacementDraftTab(closingTab)
          return {
            ...prevState,
            rawTabs: [replacementTab],
            activeTabId: replacementTab.id,
          }
        }

        if (tabId === prevState.activeTabId) {
          const newIndex = Math.min(index, next.length - 1)
          return { ...prevState, rawTabs: next, activeTabId: next[newIndex].id }
        }

        return { ...prevState, rawTabs: next }
      })

      if (shouldActivateConversation) {
        activateConversationPane()
      }
    },
    [activateConversationPane, makeReplacementDraftTab, persistenceMode]
  )

  const closeConversationTab = useCallback(
    (folderId: number, conversationId: number, agentType: AgentType) => {
      const target = rawTabsRef.current.find(
        (tab) =>
          tab.folderId === folderId &&
          tab.conversationId === conversationId &&
          tab.agentType === agentType
      )
      if (!target) return
      closeTab(target.id)
    },
    [closeTab]
  )

  const closeOtherTabs = useCallback((tabId: string) => {
    setTabState((prevState) => {
      const target = prevState.rawTabs.find((tab) => tab.id === tabId)
      if (!target) return prevState
      if (
        prevState.rawTabs.length === 1 &&
        prevState.rawTabs[0]?.id === tabId &&
        prevState.activeTabId === tabId
      ) {
        return prevState
      }
      return {
        ...prevState,
        rawTabs: [target],
        activeTabId: tabId,
      }
    })
  }, [])

  const closeAllTabs = useCallback(() => {
    if (persistenceMode === "window-local" || foldersRef.current.length === 0) {
      setTabState((prevState) => {
        if (prevState.rawTabs.length === 0 && prevState.activeTabId == null) {
          return prevState
        }
        return { ...prevState, rawTabs: [], activeTabId: null }
      })
      return
    }

    setTabState((prevState) => {
      const seedTab =
        prevState.rawTabs.find(
          (t) => t.conversationId == null && t.workingDir
        ) ??
        prevState.rawTabs.find((t) => t.id === prevState.activeTabId) ??
        prevState.rawTabs[0]
      const replacementTab = makeReplacementDraftTab(seedTab)
      return {
        ...prevState,
        rawTabs: [replacementTab],
        activeTabId: replacementTab.id,
      }
    })
    activateConversationPane()
  }, [activateConversationPane, makeReplacementDraftTab, persistenceMode])

  const closeTabsByFolder = useCallback((folderId: number) => {
    setTabState((prevState) => {
      const remaining = prevState.rawTabs.filter((t) => t.folderId !== folderId)
      if (remaining.length === prevState.rawTabs.length) return prevState

      const currentActive = prevState.activeTabId
      const stillActive =
        currentActive != null && remaining.some((t) => t.id === currentActive)

      return {
        ...prevState,
        rawTabs: remaining,
        activeTabId: stillActive ? currentActive : (remaining[0]?.id ?? null),
      }
    })
  }, [])

  const switchTab = useCallback(
    (tabId: string) => {
      const tab = rawTabsRef.current.find((t) => t.id === tabId)
      if (!tab) return

      setTabState((prevState) => {
        if (!prevState.rawTabs.some((t) => t.id === tabId)) {
          return prevState
        }
        if (prevState.activeTabId === tabId) return prevState
        return { ...prevState, activeTabId: tabId }
      })
      activateConversationPane()
    },
    [activateConversationPane]
  )

  const pinTab = useCallback(
    (tabId: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, isPinned: true } : t))
      )
    },
    [setTabs]
  )

  const toggleTileMode = useCallback(() => {
    setIsTileMode((prev) => !prev)
  }, [])

  const reorderTabs = useCallback(
    (reorderedTabs: TabItem[]) => setTabs(reorderedTabs),
    [setTabs]
  )

  const openNewConversationTab = useCallback(
    (
      folderId: number,
      workingDir: string,
      options?: AgentType | { inheritFromActive?: boolean }
    ) => {
      const explicitAgent = typeof options === "string" ? options : null
      // Pick the agent for the new conversation via the shared resolver.
      // Only inherit from the active tab when the caller opted in. The
      // active tab counts as a valid inherit source if it's either:
      //   - a real conversation (`conversationId != null`), or
      //   - a draft whose agent the user has already confirmed
      //     (`!agentTypeProvisional`).
      // We refuse to inherit from a draft whose agent is still a system
      // best-guess — propagating that across folders would launder
      // uncertainty into a value the resolver treats as explicit intent.
      // Sidebar/toolbar entry points pass `inheritFromActive: false`
      // (default) so a new conversation for folder B doesn't silently
      // pick up folder A's agent just because A happened to be focused.
      // AgentSelector will further pick the first available agent if the
      // chosen one is disabled or uninstalled.
      const inheritFromActive =
        typeof options === "object" && options?.inheritFromActive === true
      let inherit: AgentType | null = null
      if (inheritFromActive) {
        const activeTab = rawTabsRef.current.find(
          (t) => t.id === activeTabIdRef.current
        )
        if (
          activeTab &&
          (activeTab.conversationId != null || !activeTab.agentTypeProvisional)
        ) {
          inherit = activeTab.agentType
        }
      }
      const { agentType: resolvedAgent, provisional: resolvedProvisional } =
        resolveAgentForFolder(folderId, inherit)
      const targetAgent = explicitAgent ?? resolvedAgent
      const provisional = explicitAgent == null ? resolvedProvisional : false

      const tabId = makeNewConversationTabId()
      setTabState((prevState) => {
        // Singleton: reuse any existing draft tab regardless of folder,
        // so only one new-conversation tab can exist at a time. Read from
        // committed state here so batched closes cannot leave activeTabId
        // pointing at a draft that no longer exists.
        const existingTab = prevState.rawTabs.find(
          (t) => t.conversationId == null
        )

        if (!existingTab) {
          const newTab: TabItemInternal = {
            id: tabId,
            kind: "conversation",
            folderId,
            conversationId: null,
            agentType: targetAgent,
            title: t("newConversation"),
            isPinned: true,
            workingDir,
            agentTypeProvisional: provisional,
          }
          return {
            ...prevState,
            rawTabs: [...prevState.rawTabs, newTab],
            activeTabId: tabId,
          }
        }

        const folderChanged = existingTab.folderId !== folderId
        const workingDirChanged = existingTab.workingDir !== workingDir
        const agentChanged = existingTab.agentType !== targetAgent
        const provisionalChanged =
          (existingTab.agentTypeProvisional ?? false) !== provisional

        if (folderChanged || agentChanged) {
          return {
            ...prevState,
            activeTabId: existingTab.id,
            draftRetargetRequests: [
              ...prevState.draftRetargetRequests,
              {
                tabId: existingTab.id,
                expectedAgent: existingTab.agentType,
                folderId,
                workingDir,
                agentType: targetAgent,
                provisional,
              },
            ],
          }
        }

        if (workingDirChanged || provisionalChanged) {
          return {
            ...prevState,
            rawTabs: prevState.rawTabs.map((tab) =>
              tab.id === existingTab.id
                ? {
                    ...tab,
                    workingDir,
                    agentTypeProvisional: provisional,
                  }
                : tab
            ),
            activeTabId: existingTab.id,
          }
        }

        if (prevState.activeTabId === existingTab.id) return prevState
        return { ...prevState, activeTabId: existingTab.id }
      })
      activateConversationPane()
    },
    [activateConversationPane, resolveAgentForFolder, t]
  )

  const confirmDraftAgent = useCallback(
    (tabId: string, agentType: AgentType) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t
          if (t.conversationId != null) return t // not a draft
          if (t.agentType === agentType && !t.agentTypeProvisional) return t
          return { ...t, agentType, agentTypeProvisional: false }
        })
      )
    },
    [setTabs]
  )

  const setDraftAgentFromFallback = useCallback(
    (tabId: string, agentType: AgentType) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t
          if (t.conversationId != null) return t // not a draft
          // Already at this agent AND already flagged provisional — no
          // change. Otherwise patch the agent and ensure provisional stays
          // true so correction will re-resolve.
          if (t.agentType === agentType && t.agentTypeProvisional) return t
          return { ...t, agentType, agentTypeProvisional: true }
        })
      )
    },
    [setTabs]
  )

  const bindConversationTab = useCallback(
    (
      tabId: string,
      conversationId: number,
      agentType: AgentType,
      title: string,
      runtimeConversationId?: number
    ) => {
      setTabState((prevState) => {
        const targetTab = prevState.rawTabs.find((tab) => tab.id === tabId)
        if (!targetTab) return prevState

        const nextTabs = prevState.rawTabs.flatMap((tab) => {
          if (tab.id === tabId) {
            const nextTab: TabItemInternal = {
              ...tab,
              conversationId,
              agentType,
              title,
              runtimeConversationId,
              // Bound to a real conversation now — drop the provisional
              // hint so the correction effect never revisits it.
              agentTypeProvisional: false,
            }
            return [nextTab]
          }

          // Drop any other tab that already represents the same
          // (conversationId, agentType) — conversation IDs are globally
          // unique, so two tabs pointing at the same one would diverge
          // immediately. (The `tab.folderId === tab.folderId` tautology
          // that used to live here was a no-op; the dedupe was always
          // scoped to (conversationId, agentType).)
          if (
            tab.conversationId === conversationId &&
            tab.agentType === agentType
          ) {
            return []
          }

          return [tab]
        })

        const activeStillExists =
          prevState.activeTabId != null &&
          nextTabs.some((tab) => tab.id === prevState.activeTabId)
        const boundTab = nextTabs.find((tab) => tab.id === tabId)

        return {
          ...prevState,
          rawTabs: nextTabs,
          activeTabId: activeStillExists
            ? prevState.activeTabId
            : (boundTab?.id ?? nextTabs[0]?.id ?? null),
        }
      })
    },
    []
  )

  const setTabRuntimeConversationId = useCallback(
    (tabId: string, runtimeConversationId: number) => {
      setTabs((prev) => {
        const target = prev.find((tab) => tab.id === tabId)
        if (!target || target.runtimeConversationId === runtimeConversationId) {
          return prev
        }
        return prev.map((tab) =>
          tab.id === tabId ? { ...tab, runtimeConversationId } : tab
        )
      })
    },
    [setTabs]
  )

  const setTabFolder = useCallback(
    (tabId: string, folderId: number, workingDir: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId ? { ...tab, folderId, workingDir } : tab
        )
      )
    },
    [setTabs]
  )

  // Once the agent list is fresh for the first time this session, fix up
  // any draft tabs whose agent was assigned from a stale cache or the
  // global fallback. Two cases need correction:
  //   1. agentTypeProvisional flag is set (system best-guess at creation)
  //   2. agentType is no longer in the fresh sorted list (hydrated draft
  //      whose agent has since been disabled or uninstalled)
  // Each correction runs in an independent async IIFE so the disconnect-
  // then-patch dance doesn't serialize across drafts. The IIFE
  // re-checks the tab's current `agentType` after the disconnect resolves;
  // if anything else patched it during the await (most notably
  // `confirmDraftAgent` from a user click), that write wins.
  // Runs at most once per session (correctionRanRef).
  const correctionRanRef = useRef(false)
  const correctDraftAgents = useCallback(() => {
    const candidates = rawTabsRef.current.filter((tab) => {
      if (tab.conversationId != null) return false
      if (tab.agentTypeProvisional) return true
      if (!sortedAvailableAgentsRef.current.includes(tab.agentType)) return true
      return false
    })
    if (candidates.length === 0) return

    for (const tab of candidates) {
      void (async () => {
        const { agentType: newAgent } = resolveAgentForFolder(
          tab.folderId,
          null
        )
        const current = rawTabsRef.current.find((t) => t.id === tab.id)
        if (!current || current.conversationId != null) return

        if (current.agentType === newAgent) {
          // Same value — nothing to disconnect/reconnect. If the tab was
          // flagged provisional (system best-guess that happened to land
          // on the right answer), clear the flag so future checks treat
          // it as confirmed.
          if (!current.agentTypeProvisional) return
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tab.id &&
              t.conversationId == null &&
              t.agentTypeProvisional
                ? { ...t, agentTypeProvisional: false }
                : t
            )
          )
          return
        }

        // Agent changed — disconnect the old ACP session first, then
        // patch agentType. Connection lifecycle re-attaches against the
        // new agent once the patched tab prop reaches detail-panel.
        const expectedAgent = current.agentType
        try {
          await acpDisconnect(tab.id)
        } catch (err) {
          // Log and proceed. Backend disconnect rejects when the front-
          // end and backend connection registries briefly diverge (e.g.
          // tab created but ACP session never finished spinning up);
          // returning here would leave the draft stuck on the wrong
          // agent because `correctionRanRef` is one-shot per session.
          // The race guard below still protects a concurrent user click.
          // This mirrors `openNewConversationTab`'s disconnect dance.
          console.error("[TabProvider] correct provisional disconnect:", err)
        }

        // Race guard: if `agentType` changed during the await, decide
        // whether that change should win:
        //   - User click (`confirmDraftAgent`) clears the provisional
        //     flag — that's an explicit choice, bail out.
        //   - AgentSelector auto-fallback (`setDraftAgentFromFallback`)
        //     keeps the flag set — that's still a system pick, we should
        //     proceed and apply the folder default on top.
        // When agentType is unchanged, fall through and patch — covers
        // the hydrated-draft case (agent disabled/uninstalled, flag was
        // never true, nobody touched it during await).
        setTabs((prev) => {
          const target = prev.find((t) => t.id === tab.id)
          if (!target) return prev
          if (target.conversationId != null) return prev
          if (
            target.agentType !== expectedAgent &&
            !target.agentTypeProvisional
          ) {
            return prev
          }
          return prev.map((t) =>
            t.id === tab.id
              ? { ...t, agentType: newAgent, agentTypeProvisional: false }
              : t
          )
        })
      })()
    }
  }, [acpDisconnect, resolveAgentForFolder, setTabs])

  // Correction must wait for ALL THREE of:
  //   1. `agentsFresh` — the sorted agent list is real (not localStorage seed).
  //   2. `tabsHydrated` — persisted drafts are loaded into `rawTabs`.
  //   3. `foldersHydrated` — `foldersRef.current` reflects the real folder
  //      list, so `resolveAgentForFolder` can read each draft's folder
  //      `default_agent_type`. Without this gate, correction can fire in
  //      the (agents → tabs → folders) race window: `foldersRef.current`
  //      is `[]`, the resolver falls through to `sortedTypes[0]`, and the
  //      folder's persisted default is silently dropped — `correctionRanRef`
  //      is one-shot per session, so the folder default never gets applied
  //      even after it arrives.
  //
  // No timer-based fallback: if `acpListAgents()` never succeeds this
  // session, drafts simply keep their `agentTypeProvisional` hint. The
  // flag is internal-only (no UI consumer reads it) and is cleared
  // unconditionally by `bindConversationTab` and `confirmDraftAgent`, so
  // leaving it set is safer than racing to clear it and risking a "fresh
  // arrived late" case where we'd no longer be able to identify which
  // drafts came from a stale seed.
  useEffect(() => {
    if (correctionRanRef.current) return
    if (!agentsFresh) return
    if (!tabsHydrated) return
    if (!foldersHydrated) return
    correctionRanRef.current = true
    correctDraftAgents()
  }, [agentsFresh, tabsHydrated, foldersHydrated, correctDraftAgents])

  const value = useMemo<TabContextValue>(
    () => ({
      tabs,
      activeTabId,
      activeTabActivationSeq,
      tabsHydrated,
      tabPersistenceMode: persistenceMode,
      isTileMode,
      openTab,
      closeTab,
      closeConversationTab,
      closeOtherTabs,
      closeAllTabs,
      closeTabsByFolder,
      switchTab,
      pinTab,
      toggleTileMode,
      openNewConversationTab,
      confirmDraftAgent,
      setDraftAgentFromFallback,
      bindConversationTab,
      setTabRuntimeConversationId,
      setTabFolder,
      reorderTabs,
      onPreviewTabReplaced,
    }),
    [
      tabs,
      activeTabId,
      activeTabActivationSeq,
      tabsHydrated,
      persistenceMode,
      isTileMode,
      openTab,
      closeTab,
      closeConversationTab,
      closeOtherTabs,
      closeAllTabs,
      closeTabsByFolder,
      switchTab,
      pinTab,
      toggleTileMode,
      openNewConversationTab,
      confirmDraftAgent,
      setDraftAgentFromFallback,
      bindConversationTab,
      setTabRuntimeConversationId,
      setTabFolder,
      reorderTabs,
      onPreviewTabReplaced,
    ]
  )

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>
}
