"use client"

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react"
import { useTranslations } from "next-intl"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import { useAcpActions } from "@/contexts/acp-connections-context"
import {
  TabContext,
  bumpActivationSeq,
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
import {
  listOpenedTabs,
  saveOpenedTabs,
  syncConversationWindowOwnership,
} from "@/lib/api"
import type { AgentType, ConversationStatus, OpenedTab } from "@/lib/types"
import { AGENT_DISPLAY_ORDER } from "@/lib/types"

export { useTabContext }
export type { TabItem }

interface TabProviderProps {
  children: ReactNode
  persistenceMode?: TabPersistenceMode
  bootstrapState?: WorkspaceBootstrapState
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
  const { conversations, folders, setActiveFolderId } = useAppWorkspace()
  const { disconnect: acpDisconnect } = useAcpActions()

  const [rawTabs, setTabs] = useState<TabItemInternal[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [activeTabActivationSeq, setActiveTabActivationSeq] = useState(0)
  const [tabsHydrated, setTabsHydrated] = useState(false)

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
  }, [bootstrapState?.target, persistenceMode, t])

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
      let activateTabId: string | undefined
      let replacedPreviewTabId: string | undefined

      setTabs((prev) => {
        const existingIndex = findTabIndexForConversation(
          prev,
          folderId,
          agentType,
          conversationId
        )

        if (existingIndex >= 0) {
          activateTabId = prev[existingIndex].id
          if (pin && !prev[existingIndex].isPinned) {
            const updated = [...prev]
            updated[existingIndex] = {
              ...updated[existingIndex],
              isPinned: true,
            }
            return updated
          }
          return prev
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
        activateTabId = tabId
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
          return [...prev, newTab]
        }

        const previewIndex = prev.findIndex((t) => !t.isPinned)
        if (previewIndex >= 0) {
          replacedPreviewTabId = prev[previewIndex].id
          const updated = [...prev]
          updated[previewIndex] = newTab
          return updated
        }

        return [...prev, newTab]
      })

      if (replacedPreviewTabId) {
        for (const cb of previewReplacedCallbacksRef.current) {
          cb(replacedPreviewTabId)
        }
      }

      if (activateTabId) {
        setActiveTabId(activateTabId)
      }
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
      const agentType: AgentType =
        preferred?.agentType ?? AGENT_DISPLAY_ORDER[0]
      return {
        id: makeNewConversationTabId(),
        kind: "conversation",
        folderId,
        conversationId: null,
        agentType,
        title: t("newConversation"),
        isPinned: true,
        workingDir,
      }
    },
    [t]
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
      let neighborToSync: TabItemInternal | undefined
      let shouldReplaceWithEmpty = false

      setTabs((prev) => {
        const index = prev.findIndex((t) => t.id === tabId)
        if (index < 0) return prev

        const closingTab = prev[index]
        const next = prev.filter((t) => t.id !== tabId)

        if (next.length === 0) {
          if (
            persistenceMode === "window-local" ||
            foldersRef.current.length === 0
          ) {
            shouldReplaceWithEmpty = true
            return []
          }
          const replacementTab = makeReplacementDraftTab(closingTab)
          neighborToSync = replacementTab
          return [replacementTab]
        }

        if (tabId === activeTabIdRef.current) {
          const newIndex = Math.min(index, next.length - 1)
          neighborToSync = next[newIndex]
        }

        return next
      })

      if (shouldReplaceWithEmpty) {
        setActiveTabId(null)
        return
      }

      if (neighborToSync) {
        setActiveTabId(neighborToSync.id)
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
    setTabs((prev) => {
      const kept = prev.filter((t) => t.id === tabId)
      return kept.length === prev.length ? prev : kept
    })
    setActiveTabId(tabId)
  }, [])

  const closeAllTabs = useCallback(() => {
    const seedTab =
      rawTabsRef.current.find(
        (t) => t.conversationId == null && t.workingDir
      ) ??
      rawTabsRef.current.find((t) => t.id === activeTabIdRef.current) ??
      rawTabsRef.current[0]

    if (persistenceMode === "window-local" || foldersRef.current.length === 0) {
      setTabs([])
      setActiveTabId(null)
      return
    }

    const replacementTab = makeReplacementDraftTab(seedTab)
    setTabs([replacementTab])
    setActiveTabId(replacementTab.id)
    activateConversationPane()
  }, [activateConversationPane, makeReplacementDraftTab, persistenceMode])

  const closeTabsByFolder = useCallback((folderId: number) => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.folderId !== folderId)
      if (remaining.length === prev.length) return prev

      const currentActive = activeTabIdRef.current
      const stillActive =
        currentActive != null && remaining.some((t) => t.id === currentActive)
      if (!stillActive) {
        setActiveTabId(remaining.length > 0 ? remaining[0].id : null)
      }
      return remaining
    })
  }, [])

  const switchTab = useCallback(
    (tabId: string) => {
      const tab = rawTabsRef.current.find((t) => t.id === tabId)
      if (!tab) return

      setActiveTabId(tabId)
      activateConversationPane()
    },
    [activateConversationPane]
  )

  const pinTab = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, isPinned: true } : t))
    )
  }, [])

  const toggleTileMode = useCallback(() => {
    setIsTileMode((prev) => !prev)
  }, [])

  const reorderTabs = useCallback(
    (reorderedTabs: TabItem[]) => setTabs(reorderedTabs),
    []
  )

  const openNewConversationTab = useCallback(
    (folderId: number, workingDir: string, agentType?: AgentType) => {
      // Resolve the folder's saved default agent if any; otherwise fall
      // back to AGENT_DISPLAY_ORDER[0]. AgentSelector will further fall
      // back to the first *available* agent if this one is disabled or
      // not installed. Explicit callers can still override the default.
      const folderDefault = folders.find(
        (f) => f.id === folderId
      )?.default_agent_type
      const targetAgent: AgentType =
        agentType ?? folderDefault ?? AGENT_DISPLAY_ORDER[0]

      // Singleton: reuse any existing draft tab regardless of folder,
      // so only one new-conversation tab can exist at a time.
      const existingTab = rawTabsRef.current.find(
        (t) => t.conversationId == null
      )

      if (existingTab) {
        const folderChanged = existingTab.folderId !== folderId
        const workingDirChanged = existingTab.workingDir !== workingDir
        const agentChanged = existingTab.agentType !== targetAgent

        setActiveTabId(existingTab.id)
        activateConversationPane()

        if (folderChanged || agentChanged) {
          // Tear down the old ACP connection (bound to the old
          // workingDir/agent) before patching tab fields. The
          // connection-lifecycle effect watches workingDir and
          // agentType; once status has settled to disconnected and
          // either flips, it auto-reconnects against the new params.
          void (async () => {
            try {
              await acpDisconnect(existingTab.id)
            } catch (err) {
              console.error("[TabProvider] disconnect draft tab:", err)
            }
            setTabs((prev) =>
              prev.map((t) =>
                t.id === existingTab.id
                  ? {
                      ...t,
                      folderId,
                      workingDir,
                      agentType: targetAgent,
                    }
                  : t
              )
            )
          })()
        } else if (workingDirChanged) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === existingTab.id ? { ...t, workingDir } : t
            )
          )
        }
        return
      }

      const tabId = makeNewConversationTabId()
      const newTab: TabItemInternal = {
        id: tabId,
        kind: "conversation",
        folderId,
        conversationId: null,
        agentType: targetAgent,
        title: t("newConversation"),
        isPinned: true,
        workingDir,
      }

      setTabs((prev) => [...prev, newTab])
      setActiveTabId(tabId)
      activateConversationPane()
    },
    [acpDisconnect, activateConversationPane, folders, t]
  )

  const bindConversationTab = useCallback(
    (
      tabId: string,
      conversationId: number,
      agentType: AgentType,
      title: string,
      runtimeConversationId?: number
    ) => {
      let nextActiveTabId: string | null = null
      setTabs((prev) => {
        const targetTab = prev.find((tab) => tab.id === tabId)
        if (!targetTab) return prev

        return prev.flatMap((tab) => {
          if (tab.id === tabId) {
            const nextTab: TabItemInternal = {
              ...tab,
              conversationId,
              agentType,
              title,
              runtimeConversationId,
            }
            return [nextTab]
          }

          if (
            tab.folderId === targetTab.folderId &&
            tab.conversationId === conversationId &&
            tab.agentType === agentType
          ) {
            if (activeTabIdRef.current === tab.id) {
              nextActiveTabId = tabId
            }
            return []
          }

          return [tab]
        })
      })
      if (nextActiveTabId) {
        setActiveTabId(nextActiveTabId)
      }
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
    []
  )

  const setTabFolder = useCallback(
    (tabId: string, folderId: number, workingDir: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId ? { ...tab, folderId, workingDir } : tab
        )
      )
    },
    []
  )

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
      bindConversationTab,
      setTabRuntimeConversationId,
      setTabFolder,
      reorderTabs,
      onPreviewTabReplaced,
    ]
  )

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>
}
