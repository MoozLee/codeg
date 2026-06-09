"use client"

import { useCallback, useEffect, useRef } from "react"
import {
  focusConversationWindowIfOpen,
  getSystemConversationOpenSettings,
  openWorkspaceWindow,
  registerConversationWindowOwner,
} from "@/lib/api"
import type { AgentType } from "@/lib/types"
import { useTabContext } from "@/contexts/tab-context"

interface OpenConversationParams {
  folderId: number
  conversationId: number
  agentType: AgentType
  pin?: boolean
  explicitWindow?: boolean
}

export function useOpenConversation() {
  const { openTab, closeConversationTab, tabs, tabPersistenceMode } =
    useTabContext()
  const tabsRef = useRef(tabs)
  const tabPersistenceModeRef = useRef(tabPersistenceMode)

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    tabPersistenceModeRef.current = tabPersistenceMode
  }, [tabPersistenceMode])

  return useCallback(
    async ({
      folderId,
      conversationId,
      agentType,
      pin = true,
      explicitWindow = false,
    }: OpenConversationParams) => {
      const currentTabs = tabsRef.current
      const currentTabPersistenceMode = tabPersistenceModeRef.current
      const focusExistingOwnerWindow = async () => {
        return await focusConversationWindowIfOpen(conversationId)
      }

      const openInWorkspaceTab = async () => {
        openTab(folderId, conversationId, agentType, pin, undefined)
        if (currentTabPersistenceMode === "shared") {
          await registerConversationWindowOwner(conversationId)
        }
        return { focusedExisting: false }
      }

      const openInDedicatedWindow = async () => {
        const result = await openWorkspaceWindow(
          {
            kind: "conversation",
            folderId,
            conversationId,
            agentType,
          },
          "force-new-window"
        )
        if (currentTabPersistenceMode === "shared") {
          closeConversationTab(folderId, conversationId, agentType)
        }
        return result as { focusedExisting: boolean }
      }

      const alreadyOpenInCurrentWindow = currentTabs.some(
        (tab) =>
          tab.folderId === folderId &&
          tab.conversationId === conversationId &&
          tab.agentType === agentType
      )

      if (explicitWindow) {
        return openInDedicatedWindow()
      }

      if (currentTabPersistenceMode === "window-local") {
        const focusedExistingWindow = await focusExistingOwnerWindow()
        if (focusedExistingWindow) {
          return { focusedExisting: true }
        }
        return await openInWorkspaceTab()
      }

      const focusedExistingWindow = await focusExistingOwnerWindow()
      if (focusedExistingWindow) {
        return { focusedExisting: true }
      }

      if (alreadyOpenInCurrentWindow) {
        return await openInWorkspaceTab()
      }

      const settings = await getSystemConversationOpenSettings()
      const mainWorkspaceConversationCount =
        currentTabPersistenceMode === "shared"
          ? currentTabs.filter((tab) => tab.conversationId != null).length
          : 0
      const thresholdReached =
        settings.threshold != null &&
        currentTabPersistenceMode === "shared" &&
        mainWorkspaceConversationCount >= settings.threshold

      if (thresholdReached || settings.defaultTarget === "window") {
        return openInDedicatedWindow()
      }

      return await openInWorkspaceTab()
    },
    [closeConversationTab, openTab]
  )
}
