"use client"

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import type { AgentType } from "@/lib/types"
import { closeCurrentWindow } from "@/lib/platform"
import {
  TabContext,
  type TabContextValue,
  type TabItem,
  bumpActivationSeq,
  makeConversationTabId,
} from "@/contexts/tab-shared"

interface ConversationWindowTabProviderProps {
  children: ReactNode
  folderId: number
  conversationId: number
  agentType: AgentType
  title: string
  workingDir?: string
}

export function ConversationWindowTabProvider({
  children,
  folderId,
  conversationId,
  agentType,
  title,
  workingDir,
}: ConversationWindowTabProviderProps) {
  const tabId = useMemo(
    () => makeConversationTabId(folderId, agentType, conversationId),
    [folderId, agentType, conversationId]
  )

  const [tabs, setTabs] = useState<TabItem[]>([
    {
      id: tabId,
      kind: "conversation",
      folderId,
      conversationId,
      agentType,
      title,
      isPinned: true,
      workingDir,
    },
  ])
  const [activeTabId, setActiveTabId] = useState<string | null>(tabId)
  const [activeTabActivationSeq, setActiveTabActivationSeq] = useState(0)
  const [isTileMode] = useState(false)
  const previewCallbacksRef = useRef(new Set<(tabId: string) => void>())

  const openTab = useCallback(
    (
      nextFolderId: number,
      nextConversationId: number,
      nextAgentType: AgentType,
      pin = true,
      nextTitle?: string
    ) => {
      const nextTabId = makeConversationTabId(
        nextFolderId,
        nextAgentType,
        nextConversationId
      )
      setTabs([
        {
          id: nextTabId,
          kind: "conversation",
          folderId: nextFolderId,
          conversationId: nextConversationId,
          agentType: nextAgentType,
          title: nextTitle ?? title,
          isPinned: pin,
          workingDir,
        },
      ])
      setActiveTabId(nextTabId)
      bumpActivationSeq(setActiveTabActivationSeq)
    },
    [title, workingDir]
  )

  const closeTab = useCallback(
    (closingTabId: string) => {
      if (closingTabId !== activeTabId) return
      void closeCurrentWindow()
    },
    [activeTabId]
  )

  const closeConversationTab = useCallback(
    (
      nextFolderId: number,
      nextConversationId: number,
      nextAgentType: AgentType
    ) => {
      const nextTabId = makeConversationTabId(
        nextFolderId,
        nextAgentType,
        nextConversationId
      )
      if (nextTabId !== activeTabId) return
      void closeCurrentWindow()
    },
    [activeTabId]
  )

  const closeOtherTabs = useCallback(() => {}, [])

  const closeAllTabs = useCallback(() => {
    void closeCurrentWindow()
  }, [])

  const closeTabsByFolder = useCallback(
    (targetFolderId: number) => {
      if (targetFolderId !== folderId) return
      void closeCurrentWindow()
    },
    [folderId]
  )

  const switchTab = useCallback((nextTabId: string) => {
    setActiveTabId(nextTabId)
    bumpActivationSeq(setActiveTabActivationSeq)
  }, [])

  const pinTab = useCallback((nextTabId: string) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === nextTabId ? { ...tab, isPinned: true } : tab
      )
    )
  }, [])

  const toggleTileMode = useCallback(() => {}, [])

  const openNewConversationTab = useCallback(() => {}, [])

  const bindConversationTab = useCallback(
    (
      currentTabId: string,
      nextConversationId: number,
      nextAgentType: AgentType,
      nextTitle: string,
      runtimeConversationId?: number
    ) => {
      const nextTabId = makeConversationTabId(
        folderId,
        nextAgentType,
        nextConversationId
      )
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === currentTabId
            ? {
                ...tab,
                id: nextTabId,
                conversationId: nextConversationId,
                agentType: nextAgentType,
                title: nextTitle,
                runtimeConversationId,
              }
            : tab
        )
      )
      setActiveTabId(nextTabId)
      bumpActivationSeq(setActiveTabActivationSeq)
    },
    [folderId]
  )

  const setTabRuntimeConversationId = useCallback(
    (currentTabId: string, runtimeConversationId: number) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === currentTabId ? { ...tab, runtimeConversationId } : tab
        )
      )
    },
    []
  )

  const setTabFolder = useCallback(
    (currentTabId: string, nextFolderId: number, nextWorkingDir: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === currentTabId
            ? { ...tab, folderId: nextFolderId, workingDir: nextWorkingDir }
            : tab
        )
      )
    },
    []
  )

  const reorderTabs = useCallback((reorderedTabs: TabItem[]) => {
    setTabs(reorderedTabs)
  }, [])

  const onPreviewTabReplaced = useCallback(
    (callback: (tabId: string) => void) => {
      previewCallbacksRef.current.add(callback)
      return () => {
        previewCallbacksRef.current.delete(callback)
      }
    },
    []
  )

  const value = useMemo<TabContextValue>(
    () => ({
      tabs,
      activeTabId,
      activeTabActivationSeq,
      tabsHydrated: true,
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
