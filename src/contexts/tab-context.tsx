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
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { listOpenedTabs, saveOpenedTabs } from "@/lib/api"
import type { AgentType, ConversationStatus, OpenedTab } from "@/lib/types"
import { AGENT_DISPLAY_ORDER } from "@/lib/types"
import {
  TabContext,
  type TabItem,
  type TabItemInternal,
  bumpActivationSeq,
  findTabIndexForConversation,
  makeConversationTabId,
  makeNewConversationTabId,
} from "@/contexts/tab-shared"

export { useTabContext } from "@/contexts/tab-shared"
export type { TabItem } from "@/contexts/tab-shared"

interface TabProviderProps {
  children: ReactNode
}

const TILE_MODE_STORAGE_KEY = "workspace:tile-mode"

export function TabProvider({ children }: TabProviderProps) {
  const t = useTranslations("Folder.tabContext")
  const { activateConversationPane } = useWorkspaceContext()
  const { conversations, folders, setActiveFolderId } = useAppWorkspace()
  const { disconnect: acpDisconnect } = useAcpActions()

  const [rawTabs, setTabs] = useState<TabItemInternal[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [activeTabActivationSeq, setActiveTabActivationSeq] = useState(0)
  const [tabsHydrated, setTabsHydrated] = useState(false)

  // Refs for volatile state
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const rawTabsRef = useRef(rawTabs)
  useEffect(() => {
    rawTabsRef.current = rawTabs
  }, [rawTabs])

  // Sync active tab's folderId up to AppWorkspaceProvider so derived
  // consumers (ActiveFolderProvider, branch polling, etc.) reflect the
  // currently-focused folder.
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

  const activateTab = useCallback((tabId: string | null) => {
    activeTabIdRef.current = tabId
    setActiveTabId(tabId)
    bumpActivationSeq(setActiveTabActivationSeq)
  }, [])

  // Hydrate from persisted opened_tabs on mount
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
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
          if (activeRestored) {
            activateTab(activeRestored.id)
          }
        } else if (restored.length > 0) {
          activateTab(restored[0].id)
        }
      } catch (err) {
        console.error("[TabProvider] listOpenedTabs failed:", err)
      } finally {
        if (!cancelled) setTabsHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activateTab, t])

  // Debounced save to DB
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!tabsHydrated) return

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
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
  }, [rawTabs, activeTabId, tabsHydrated])

  // Pre-index conversations for O(1) lookup in tabs derivation
  const conversationMap = useMemo(() => {
    const m = new Map<string, (typeof conversations)[number]>()
    for (const c of conversations) {
      m.set(`${c.folder_id}-${c.agent_type}-${c.id}`, c)
    }
    return m
  }, [conversations])

  // Derive tabs with up-to-date titles and status from conversations
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
        activateTab(activateTabId)
      }
      activateConversationPane()
    },
    [activateConversationPane, activateTab, t]
  )

  const makeReplacementDraftTab = useCallback(
    (preferred?: TabItemInternal): TabItemInternal => {
      const folderId = preferred?.folderId ?? foldersRef.current[0]?.id ?? 0
      const workingDir =
        preferred?.workingDir ??
        foldersRef.current.find((f) => f.id === folderId)?.path ??
        ""
      return {
        id: makeNewConversationTabId(),
        kind: "conversation",
        folderId,
        conversationId: null,
        agentType: AGENT_DISPLAY_ORDER[0],
        title: t("newConversation"),
        isPinned: true,
        workingDir,
      }
    },
    [t]
  )

  const [isTileMode, setIsTileMode] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return localStorage.getItem(TILE_MODE_STORAGE_KEY) === "true"
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(TILE_MODE_STORAGE_KEY, String(isTileMode))
    } catch {
      /* ignore */
    }
  }, [isTileMode])

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
          if (foldersRef.current.length === 0) {
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
        activateTab(null)
        return
      }

      if (neighborToSync) {
        activateTab(neighborToSync.id)
        activateConversationPane()
      }
    },
    [activateConversationPane, activateTab, makeReplacementDraftTab]
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

  const closeOtherTabs = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const kept = prev.filter((t) => t.id === tabId)
        return kept.length === prev.length ? prev : kept
      })
      activateTab(tabId)
    },
    [activateTab]
  )

  const closeAllTabs = useCallback(() => {
    const seedTab =
      rawTabsRef.current.find(
        (t) => t.conversationId == null && t.workingDir
      ) ??
      rawTabsRef.current.find((t) => t.id === activeTabIdRef.current) ??
      rawTabsRef.current[0]

    if (foldersRef.current.length === 0) {
      setTabs([])
      activateTab(null)
      return
    }

    const replacementTab = makeReplacementDraftTab(seedTab)
    setTabs([replacementTab])
    activateTab(replacementTab.id)
    activateConversationPane()
  }, [activateConversationPane, activateTab, makeReplacementDraftTab])

  const closeTabsByFolder = useCallback(
    (folderId: number) => {
      let nextActiveTabId: string | null | undefined

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.folderId !== folderId)
        if (remaining.length === prev.length) return prev

        // If active tab is being closed, move to first remaining tab
        const currentActive = activeTabIdRef.current
        const stillActive =
          currentActive != null && remaining.some((t) => t.id === currentActive)
        if (!stillActive) {
          nextActiveTabId = remaining.length > 0 ? remaining[0].id : null
        }
        return remaining
      })

      if (nextActiveTabId !== undefined) {
        activateTab(nextActiveTabId)
      }
    },
    [activateTab]
  )

  const switchTab = useCallback(
    (tabId: string) => {
      const tab = rawTabsRef.current.find((t) => t.id === tabId)
      if (!tab) return

      activateTab(tabId)
      activateConversationPane()
    },
    [activateConversationPane, activateTab]
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
    (folderId: number, workingDir: string) => {
      // Singleton: reuse any existing draft tab regardless of folder,
      // so only one new-conversation tab can exist at a time.
      const existingTab = rawTabsRef.current.find(
        (t) => t.conversationId == null
      )

      if (existingTab) {
        const folderChanged = existingTab.folderId !== folderId
        const workingDirChanged = existingTab.workingDir !== workingDir

        activateTab(existingTab.id)
        activateConversationPane()

        if (folderChanged) {
          // Tear down the old ACP connection (bound to the old
          // workingDir) before patching the tab's folderId/workingDir.
          // The connection-lifecycle effect watches workingDir; once
          // status has settled to disconnected and workingDir flips,
          // it auto-reconnects against the new folder.
          void (async () => {
            try {
              await acpDisconnect(existingTab.id)
            } catch (err) {
              console.error("[TabProvider] disconnect draft tab:", err)
            }
            setTabs((prev) =>
              prev.map((t) =>
                t.id === existingTab.id ? { ...t, folderId, workingDir } : t
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

      const agentType = AGENT_DISPLAY_ORDER[0]
      const tabId = makeNewConversationTabId()
      const newTab: TabItemInternal = {
        id: tabId,
        kind: "conversation",
        folderId,
        conversationId: null,
        agentType,
        title: t("newConversation"),
        isPinned: true,
        workingDir,
      }

      setTabs((prev) => [...prev, newTab])
      activateTab(tabId)
      activateConversationPane()
    },
    [acpDisconnect, activateConversationPane, activateTab, t]
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
        activateTab(nextActiveTabId)
      }
    },
    [activateTab]
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

  const value = useMemo(
    () => ({
      tabs,
      activeTabId,
      activeTabActivationSeq,
      tabsHydrated,
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
