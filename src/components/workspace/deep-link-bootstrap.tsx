"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import { useTabContext } from "@/contexts/tab-context"
import { useOpenConversation } from "@/hooks/use-open-conversation"
import type { AgentType } from "@/lib/types"

/**
 * Handles `/workspace?folderId=X&conversationId=Y&agent=Z` URLs.
 * Runs once after both folders and tabs have hydrated.
 */
export function DeepLinkBootstrap() {
  const t = useTranslations("ConversationPage")
  const { foldersHydrated, folders, addFolderToWorkspaceById, conversations } =
    useAppWorkspace()
  const { tabsHydrated } = useTabContext()
  const openConversation = useOpenConversation()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    if (!foldersHydrated || !tabsHydrated) return
    ranRef.current = true

    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    const rawFolderId = params.get("folderId")
    const rawConversationId = params.get("conversationId")
    const rawAgent = params.get("agent") as AgentType | null

    if (!rawFolderId && !rawConversationId) return

    const clearUrl = () => {
      try {
        window.history.replaceState({}, "", "/workspace")
      } catch {
        /* ignore */
      }
    }

    void (async () => {
      try {
        const folderId = rawFolderId ? Number(rawFolderId) : null
        const conversationId = rawConversationId
          ? Number(rawConversationId)
          : null

        if (folderId == null || !Number.isFinite(folderId)) return
        if (conversationId == null || !Number.isFinite(conversationId)) return
        if (!rawAgent) return

        let folder = folders.find((f) => f.id === folderId)
        if (!folder) {
          try {
            folder = await addFolderToWorkspaceById(folderId)
          } catch (err) {
            console.error("[DeepLinkBootstrap] open folder failed:", err)
            toast.error(t("linkedFolderOpenFailed"))
            return
          }
        }

        const hasConv = conversations.some(
          (c) =>
            c.id === conversationId &&
            c.folder_id === folderId &&
            c.agent_type === rawAgent
        )
        if (!hasConv) {
          toast.error(t("linkedConversationNotFound"))
          return
        }

        await openConversation({
          folderId,
          conversationId,
          agentType: rawAgent,
          pin: true,
        })
      } finally {
        clearUrl()
      }
    })()
  }, [
    foldersHydrated,
    tabsHydrated,
    folders,
    conversations,
    addFolderToWorkspaceById,
    openConversation,
    t,
  ])

  return null
}
