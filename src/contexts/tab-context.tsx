"use client"

import { useEffect, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useShallow } from "zustand/react/shallow"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useAcpActions } from "@/contexts/acp-connections-context"
import { useWorkspaceActions } from "@/contexts/workspace-context"
import { useSortedAvailableAgents } from "@/hooks/use-sorted-available-agents"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import {
  runCorrectionOnce,
  runRecoveryOnce,
  useTabStore,
  type TabItem,
} from "@/stores/tab-store"
import {
  CONVERSATION_CHANGED_EVENT,
  TABS_CHANGED_EVENT,
  type ConversationChange,
  type TabsChanged,
} from "@/lib/types"
import type {
  TabPersistenceMode,
  WorkspaceBootstrapState,
} from "@/contexts/tab-shared"

export type { TabItem }
export { useTabStore, useTabActions } from "@/stores/tab-store"

interface TabProviderProps {
  children: ReactNode
  persistenceMode?: TabPersistenceMode
  bootstrapState?: WorkspaceBootstrapState
}

/**
 * Thin lifecycle glue for `useTabStore`: injects the React-land dependencies
 * (i18n labels, `activateConversationPane`, `acpDisconnect`, agent availability)
 * and drives the effects that need a React lifecycle — persisted-tab hydration,
 * the debounced save, cross-client tab/conversation subscriptions, provisional
 * agent correction, and post-hydration recovery. All state and logic live in the
 * store; this component renders only `children`.
 */
export function TabProvider({
  children,
  persistenceMode = "shared",
  bootstrapState,
}: TabProviderProps) {
  const t = useTranslations("Folder.tabContext")
  const { activateConversationPane } = useWorkspaceActions()
  const { disconnect: acpDisconnect } = useAcpActions()
  const { sortedTypes: sortedAvailableAgents, fresh: agentsFresh } =
    useSortedAvailableAgents()

  const foldersHydrated = useAppWorkspaceStore((s) => s.foldersHydrated)
  const conversations = useAppWorkspaceStore((s) => s.conversations)
  const conversationsLoading = useAppWorkspaceStore(
    (s) => s.conversationsLoading
  )

  const rawTabs = useTabStore((s) => s.rawTabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const previewReplacedTabIds = useTabStore((s) => s.previewReplacedTabIds)
  const draftRetargetRequests = useTabStore((s) => s.draftRetargetRequests)
  const tabsHydrated = useTabStore((s) => s.tabsHydrated)
  const saveReconcileTick = useTabStore((s) => s.saveReconcileTick)
  const reseedTick = useTabStore((s) => s.reseedTick)

  useEffect(() => {
    useTabStore.getState().configurePersistence(persistenceMode, bootstrapState)
  }, [persistenceMode, bootstrapState])

  // Labels first (declared before hydrate) so seed titles are translated before
  // the hydration effect runs.
  useEffect(() => {
    useTabStore.getState().setLabels({
      loadingConversation: t("loadingConversation"),
      newConversation: t("newConversation"),
      untitledConversation: t("untitledConversation"),
    })
  }, [t])

  useEffect(() => {
    useTabStore
      .getState()
      .setSideEffects({ activateConversationPane, acpDisconnect })
  }, [activateConversationPane, acpDisconnect])

  useEffect(() => {
    useTabStore
      .getState()
      .setAgentAvailability(sortedAvailableAgents, agentsFresh)
  }, [sortedAvailableAgents, agentsFresh])

  // Sync the active tab's folderId up to the app-workspace store, bump the
  // activation sequence used by the terminal manager, and sync conversation
  // window ownership for dedicated windows.
  useEffect(() => {
    useTabStore.getState().syncActiveFolderId()
  }, [rawTabs, activeTabId])

  useEffect(() => {
    useTabStore.getState().consumePreviewReplaced()
  }, [previewReplacedTabIds])

  useEffect(() => {
    useTabStore.getState().consumeDraftRetargets()
  }, [draftRetargetRequests])

  useEffect(() => useTabStore.getState().hydrate(), [])

  useEffect(() => {
    useTabStore.getState().runSaveEffect()
  }, [rawTabs, activeTabId, persistenceMode, tabsHydrated, saveReconcileTick])

  useEffect(() => () => useTabStore.getState().clearSaveTimer(), [])

  useEffect(() => {
    useTabStore.getState().reconcileChildSummaries()
  }, [rawTabs, conversations, conversationsLoading, reseedTick])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void (async () => {
      const dispose = await subscribe<ConversationChange>(
        CONVERSATION_CHANGED_EVENT,
        (change) => useTabStore.getState().handleChildConversationChange(change)
      )
      if (disposed) dispose()
      else unlisten = dispose
    })()
    const offReconnect = onTransportReconnect(() =>
      useTabStore.getState().handleChildReconnect()
    )
    return () => {
      disposed = true
      unlisten?.()
      offReconnect?.()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void (async () => {
      const dispose = await subscribe<TabsChanged>(
        TABS_CHANGED_EVENT,
        (change) => useTabStore.getState().handleTabsChanged(change)
      )
      if (disposed) {
        dispose()
        return
      }
      unlisten = dispose
      void useTabStore.getState().refetchTabs()
    })()
    const offReconnect = onTransportReconnect(() =>
      useTabStore.getState().refetchTabs()
    )
    return () => {
      disposed = true
      unlisten?.()
      offReconnect?.()
    }
  }, [])

  useEffect(() => {
    if (!agentsFresh) return
    if (!tabsHydrated) return
    if (!foldersHydrated) return
    runCorrectionOnce()
  }, [agentsFresh, tabsHydrated, foldersHydrated])

  useEffect(() => {
    if (!tabsHydrated || !foldersHydrated) return
    if (rawTabs.length > 0) return
    runRecoveryOnce()
  }, [tabsHydrated, foldersHydrated, rawTabs])

  useEffect(() => {
    useTabStore.getState().persistLastActiveContext()
  }, [rawTabs, activeTabId, tabsHydrated])

  return <>{children}</>
}

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
    agentType: TabItem["agentType"],
    pin?: boolean,
    title?: string
  ) => void
  closeTab: (tabId: string) => void
  closeConversationTab: (
    folderId: number,
    conversationId: number,
    agentType: TabItem["agentType"]
  ) => void
  closeOtherTabs: (tabId: string) => void
  closeAllTabs: () => void
  closeTabsByFolder: (folderId: number) => void
  switchTab: (tabId: string) => void
  pinTab: (tabId: string) => void
  toggleTileMode: () => void
  consumeRemoteActivation: () => boolean
  openNewConversationTab: (
    folderId: number,
    workingDir: string,
    options?: {
      inheritFromActive?: boolean
      folderDefaultAgent?: TabItem["agentType"] | null
    }
  ) => void
  openChatModeTab: () => void
  setChatDraftWorkingDir: (tabId: string, workingDir: string) => void
  confirmDraftAgent: (tabId: string, agentType: TabItem["agentType"]) => void
  setDraftAgentFromFallback: (
    tabId: string,
    agentType: TabItem["agentType"]
  ) => void
  bindConversationTab: (
    tabId: string,
    conversationId: number,
    agentType: TabItem["agentType"],
    title: string,
    runtimeConversationId?: number,
    folderId?: number,
    workingDir?: string
  ) => void
  setTabRuntimeConversationId: (
    tabId: string,
    runtimeConversationId: number
  ) => void
  setTabFolder: (tabId: string, folderId: number, workingDir: string) => void
  reorderTabs: (reorderedTabs: TabItem[]) => void
  onPreviewTabReplaced: (callback: (tabId: string) => void) => () => void
}

/**
 * Backwards-compatible whole-value accessor over the tab store. Kept so existing
 * consumers keep working during the selector migration; hot consumers should use
 * `useTabStore(selector)` / `useTabActions()` directly.
 */
export function useTabContext(): TabContextValue {
  return useTabStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      activeTabActivationSeq: s.activeTabActivationSeq,
      tabsHydrated: s.tabsHydrated,
      isTileMode: s.isTileMode,
      tabPersistenceMode: s.tabPersistenceMode,
      openTab: s.openTab,
      closeTab: s.closeTab,
      closeConversationTab: s.closeConversationTab,
      closeOtherTabs: s.closeOtherTabs,
      closeAllTabs: s.closeAllTabs,
      closeTabsByFolder: s.closeTabsByFolder,
      switchTab: s.switchTab,
      pinTab: s.pinTab,
      toggleTileMode: s.toggleTileMode,
      consumeRemoteActivation: s.consumeRemoteActivation,
      openNewConversationTab: s.openNewConversationTab,
      openChatModeTab: s.openChatModeTab,
      setChatDraftWorkingDir: s.setChatDraftWorkingDir,
      confirmDraftAgent: s.confirmDraftAgent,
      setDraftAgentFromFallback: s.setDraftAgentFromFallback,
      bindConversationTab: s.bindConversationTab,
      setTabRuntimeConversationId: s.setTabRuntimeConversationId,
      setTabFolder: s.setTabFolder,
      reorderTabs: s.reorderTabs,
      onPreviewTabReplaced: s.onPreviewTabReplaced,
    }))
  )
}
