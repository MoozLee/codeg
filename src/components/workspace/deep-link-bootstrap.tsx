"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import {
  buildWorkspaceUrlAfterBootstrap,
  hasWorkspaceBootstrapParams,
  parseWorkspaceBootstrap,
  rememberTabPersistenceMode,
} from "@/contexts/tab-shared"
import { useTabContext } from "@/contexts/tab-context"
import {
  focusConversationWindowIfOpen,
  getFolderConversation,
  registerConversationWindowOwner,
} from "@/lib/api"
import { getCurrentWindow, isDesktop } from "@/lib/platform"

/**
 * Handles `/workspace?...` bootstrap parameters for the full workspace shell.
 * Runs once after both folders and tabs have hydrated.
 */
function parseConversationIdFromWindowLabel(
  label: string | null
): number | null {
  if (!label?.startsWith("conversation-")) return null
  const parsed = Number(label.slice("conversation-".length))
  return Number.isFinite(parsed) ? parsed : null
}

export function DeepLinkBootstrap() {
  const tSidebar = useTranslations("Folder.sidebar")
  const tSidebarToasts = useTranslations("Folder.sidebar.toasts")
  const { foldersHydrated, folders, addFolderToWorkspaceById, conversations } =
    useAppWorkspace()
  const { tabsHydrated, tabs, activeTabId, openTab, openNewConversationTab } =
    useTabContext()
  const pathname = usePathname()
  const lastHandledSearchRef = useRef<string | null>(null)

  useEffect(() => {
    if (!foldersHydrated || !tabsHydrated) return
    if (typeof window === "undefined") return

    const search = window.location.search
    if (lastHandledSearchRef.current === search) {
      return
    }

    const bootstrap = parseWorkspaceBootstrap(search)
    const isWindowLocal = bootstrap.tabPersistenceMode === "window-local"

    rememberTabPersistenceMode(bootstrap.tabPersistenceMode)

    const hasBootstrapParams = hasWorkspaceBootstrapParams(search)

    if (!hasBootstrapParams && !isDesktop()) {
      lastHandledSearchRef.current = search
      return
    }

    lastHandledSearchRef.current = search

    const clearUrl = () => {
      try {
        window.history.replaceState(
          {},
          "",
          buildWorkspaceUrlAfterBootstrap(pathname || "/workspace", search)
        )
      } catch {
        /* ignore */
      }
    }

    void (async () => {
      try {
        let resolvedBootstrapTarget = bootstrap.target
        if (resolvedBootstrapTarget == null && isDesktop()) {
          const currentWindow = await getCurrentWindow()
          const conversationId = parseConversationIdFromWindowLabel(
            currentWindow?.label ?? null
          )
          if (conversationId != null) {
            try {
              const detail = await getFolderConversation(conversationId)
              resolvedBootstrapTarget = {
                kind: "conversation",
                folderId: detail.summary.folder_id,
                conversationId: detail.summary.id,
                agentType: detail.summary.agent_type,
              }
            } catch {
              /* ignore */
            }
          }
        }

        if (resolvedBootstrapTarget?.kind === "conversation") {
          const { folderId, conversationId, agentType } =
            resolvedBootstrapTarget

          let folder = folders.find((f) => f.id === folderId)
          if (!folder) {
            try {
              folder = await addFolderToWorkspaceById(folderId)
            } catch (err) {
              console.error("[DeepLinkBootstrap] open folder failed:", err)
              toast.error(tSidebarToasts("openFolderFailed"))
              return
            }
          }

          const hasConversation = conversations.some(
            (conversation) =>
              conversation.id === conversationId &&
              conversation.folder_id === folderId &&
              conversation.agent_type === agentType
          )

          let resolvedTitle: string | undefined
          if (!hasConversation) {
            try {
              const detail = await getFolderConversation(conversationId)
              if (
                detail.summary.folder_id !== folderId ||
                detail.summary.agent_type !== agentType
              ) {
                toast.error(tSidebar("noMatchingConversations"))
                return
              }
              resolvedTitle = detail.summary.title?.trim() || undefined
            } catch {
              toast.error(tSidebar("noMatchingConversations"))
              return
            }
          }

          if (isWindowLocal) {
            const focusedExisting =
              await focusConversationWindowIfOpen(conversationId)
            if (focusedExisting) {
              return
            }
          }

          openTab(folderId, conversationId, agentType, true, resolvedTitle)
          if (isDesktop()) {
            void registerConversationWindowOwner(conversationId)
          }
          return
        }

        if (resolvedBootstrapTarget?.kind === "draft") {
          const { folderId, workingDir, agentType } = resolvedBootstrapTarget

          if (folderId == null) {
            return
          }

          let folder = folders.find((entry) => entry.id === folderId)
          if (!folder) {
            try {
              folder = await addFolderToWorkspaceById(folderId)
            } catch (err) {
              console.error(
                "[DeepLinkBootstrap] open draft folder failed:",
                err
              )
              toast.error(tSidebarToasts("openFolderFailed"))
              return
            }
          }

          openNewConversationTab(
            folder.id,
            workingDir ?? folder.path,
            agentType ?? undefined
          )
        }
      } finally {
        clearUrl()
      }
    })()
  }, [
    addFolderToWorkspaceById,
    conversations,
    folders,
    foldersHydrated,
    openNewConversationTab,
    openTab,
    pathname,
    tSidebar,
    tSidebarToasts,
    tabsHydrated,
    activeTabId,
    tabs.length,
  ])

  useEffect(() => {
    if (!isDesktop()) return
    if (typeof window === "undefined") return

    let disposed = false
    let unlisten: (() => void) | undefined

    void (async () => {
      const currentWindow = await getCurrentWindow()
      const currentWindowLabel = currentWindow?.label ?? null
      const { listen } = await import("@tauri-apps/api/event")
      if (disposed) return
      unlisten = await listen<{
        conversationId?: number
        ownerLabel?: string
      }>("conversation-window-focus-target", async (event) => {
        const conversationId = event.payload?.conversationId
        const ownerLabel = event.payload?.ownerLabel
        if (typeof conversationId !== "number") return
        if (ownerLabel !== currentWindowLabel) return

        try {
          const detail = await getFolderConversation(conversationId)
          const folderId = detail.summary.folder_id
          const agentType = detail.summary.agent_type

          let folder = folders.find((entry) => entry.id === folderId)
          if (!folder) {
            folder = await addFolderToWorkspaceById(folderId)
          }

          openTab(
            folder.id,
            conversationId,
            agentType,
            true,
            detail.summary.title?.trim() || undefined
          )
        } catch (err) {
          console.error(
            "[DeepLinkBootstrap] focus-target open conversation failed:",
            err
          )
        }
      })
    })()

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [addFolderToWorkspaceById, folders, openTab])

  return null
}
