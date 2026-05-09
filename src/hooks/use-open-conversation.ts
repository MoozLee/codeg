"use client"

import { useCallback } from "react"
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

  return useCallback(
    async ({
      folderId,
      conversationId,
      agentType,
      pin = true,
      explicitWindow = false,
    }: OpenConversationParams) => {
      const focusExistingOwnerWindow = async () => {
        return await focusConversationWindowIfOpen(conversationId)
      }

      const openInWorkspaceTab = async () => {
        openTab(folderId, conversationId, agentType, pin, undefined)
        if (tabPersistenceMode === "shared") {
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
        if (tabPersistenceMode === "shared") {
          closeConversationTab(folderId, conversationId, agentType)
        }
        return result as { focusedExisting: boolean }
      }

      const alreadyOpenInCurrentWindow = tabs.some(
        (tab) =>
          tab.folderId === folderId &&
          tab.conversationId === conversationId &&
          tab.agentType === agentType
      )

      if (tabPersistenceMode === "window-local") {
        const focusedExistingWindow = await focusExistingOwnerWindow()
        if (focusedExistingWindow) {
          return { focusedExisting: true }
        }
        if (alreadyOpenInCurrentWindow) {
          return await openInWorkspaceTab()
        }
        return openInDedicatedWindow()
      }

      if (explicitWindow) {
        return openInDedicatedWindow()
      }

      if (alreadyOpenInCurrentWindow) {
        return await openInWorkspaceTab()
      }

      const focusedExistingWindow = await focusExistingOwnerWindow()
      if (focusedExistingWindow) {
        return { focusedExisting: true }
      }

      const settings = await getSystemConversationOpenSettings()
      const mainWorkspaceConversationCount =
        tabPersistenceMode === "shared"
          ? tabs.filter((tab) => tab.conversationId != null).length
          : 0
      const thresholdReached =
        settings.threshold != null &&
        tabPersistenceMode === "shared" &&
        mainWorkspaceConversationCount >= settings.threshold

      if (thresholdReached || settings.defaultTarget === "window") {
        return openInDedicatedWindow()
      }

      return await openInWorkspaceTab()
    },
    [closeConversationTab, openTab, tabPersistenceMode, tabs]
  )
}
