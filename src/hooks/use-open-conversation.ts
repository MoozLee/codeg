"use client"

import { useCallback } from "react"
import {
  openConversationWindow,
  getSystemConversationOpenSettings,
} from "@/lib/api"
import type { AgentType } from "@/lib/types"
import { useTabContext } from "@/contexts/tab-context"
import { isDesktop } from "@/lib/platform"

interface OpenConversationParams {
  folderId: number
  conversationId: number
  agentType: AgentType
  pin?: boolean
  explicitWindow?: boolean
}

export function useOpenConversation() {
  const { openTab, closeConversationTab, tabs } = useTabContext()

  return useCallback(
    async ({
      folderId,
      conversationId,
      agentType,
      pin = true,
      explicitWindow = false,
    }: OpenConversationParams) => {
      const openInWorkspaceTab = () => {
        openTab(folderId, conversationId, agentType, pin, undefined)
        return { focusedExisting: false }
      }

      const openInDedicatedWindow = async () => {
        const result = await openConversationWindow(conversationId)
        if (explicitWindow) {
          closeConversationTab(folderId, conversationId, agentType)
        }
        return result
      }

      if (isDesktop()) {
        const { Window } = await import("@tauri-apps/api/window")
        const existing = await Window.getByLabel(
          `conversation-${conversationId}`
        )
        if (existing) {
          await existing.unminimize().catch(() => {})
          await existing.setFocus().catch(() => {})
          if (explicitWindow) {
            closeConversationTab(folderId, conversationId, agentType)
          }
          return { focusedExisting: true }
        }
      }

      if (explicitWindow) {
        return openInDedicatedWindow()
      }

      const alreadyOpenInWorkspaceTab = tabs.some(
        (tab) =>
          tab.folderId === folderId &&
          tab.conversationId === conversationId &&
          tab.agentType === agentType
      )
      if (alreadyOpenInWorkspaceTab) {
        return openInWorkspaceTab()
      }

      const settings = await getSystemConversationOpenSettings()
      const mainWorkspaceConversationCount = tabs.length
      const thresholdReached =
        settings.threshold != null &&
        mainWorkspaceConversationCount >= settings.threshold

      if (thresholdReached || settings.defaultTarget === "window") {
        return openInDedicatedWindow()
      }

      return openInWorkspaceTab()
    },
    [closeConversationTab, openTab, tabs]
  )
}
