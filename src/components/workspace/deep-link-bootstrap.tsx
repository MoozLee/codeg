"use client"

import { useCallback, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import {
  buildWorkspaceUrlAfterBootstrap,
  hasAnyConsumedWorkspaceBootstrap,
  hasWorkspaceBootstrapParams,
  parseWorkspaceBootstrap,
  rememberTabPersistenceMode,
} from "@/contexts/tab-shared"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import {
  focusConversationWindowIfOpen,
  getFolderConversation,
  registerConversationWindowOwner,
} from "@/lib/api"
import { getCurrentWindow, isDesktop } from "@/lib/platform"
import type { AgentType } from "@/lib/types"

/**
 * Handles `/workspace?...` bootstrap parameters for the full workspace shell.
 * Runs once after both folders and tabs have hydrated.
 */
function parseConversationIdFromWindowLabel(
  label: string | null
): number | null {
  if (!label?.startsWith("conversation-")) return null
  const idPart = label.slice("conversation-".length).split("-", 1)[0]
  const parsed = Number(idPart)
  return Number.isFinite(parsed) ? parsed : null
}

export function DeepLinkBootstrap() {
  const tSidebar = useTranslations("Folder.sidebar")
  const tSidebarToasts = useTranslations("Folder.sidebar.toasts")
  const foldersHydrated = useAppWorkspaceStore((s) => s.foldersHydrated)
  const tabsHydrated = useTabStore((s) => s.tabsHydrated)
  const { openTab, openNewConversationTab } = useTabActions()
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

    if (!hasBootstrapParams) {
      if (!isDesktop() || hasAnyConsumedWorkspaceBootstrap()) {
        lastHandledSearchRef.current = search
        return
      }
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
          const store = useAppWorkspaceStore.getState()

          let folder = store.folders.find((f) => f.id === folderId)
          if (!folder) {
            try {
              folder = await store.addFolderToWorkspaceById(folderId)
            } catch (err) {
              console.error("[DeepLinkBootstrap] open folder failed:", err)
              toast.error(tSidebarToasts("openFolderFailed"))
              return
            }
          }

          const { conversations } = useAppWorkspaceStore.getState()
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

          const store = useAppWorkspaceStore.getState()
          let folder = store.folders.find((entry) => entry.id === folderId)
          if (!folder) {
            try {
              folder = await store.addFolderToWorkspaceById(folderId)
            } catch (err) {
              console.error(
                "[DeepLinkBootstrap] open draft folder failed:",
                err
              )
              toast.error(tSidebarToasts("openFolderFailed"))
              return
            }
          }

          openNewConversationTab(folder.id, workingDir ?? folder.path, {
            folderDefaultAgent: agentType ?? folder.default_agent_type,
          })
        }
      } finally {
        clearUrl()
      }
    })()
  }, [
    foldersHydrated,
    openNewConversationTab,
    openTab,
    pathname,
    tSidebar,
    tSidebarToasts,
    tabsHydrated,
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
          const store = useAppWorkspaceStore.getState()

          let folder = store.folders.find((entry) => entry.id === folderId)
          if (!folder) {
            folder = await store.addFolderToWorkspaceById(folderId)
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
  }, [openTab])

  return null
}

type FocusRequest = {
  folderId: number
  conversationId: number
  agent: AgentType
}

/**
 * Live counterpart to {@link DeepLinkBootstrap}: listens for the pet panel's
 * `workspace://focus-conversation` request (emitted by the `focus_conversation`
 * command after bringing the main window forward) and opens the conversation
 * via `openTab` — no URL reload, so in-memory tab/session state survives.
 *
 * Latest workspace state is held in a ref so the single subscription always
 * sees fresh state without re-subscribing on every change. A request that
 * arrives before folders/tabs hydrate is queued and replayed.
 */
export function PetFocusBridge() {
  const foldersHydrated = useAppWorkspaceStore((s) => s.foldersHydrated)
  const tabsHydrated = useTabStore((s) => s.tabsHydrated)
  const { openTab } = useTabActions()

  // Workspace state is read via getState() at attempt time; only the tab
  // half still needs a ref mirror (it lives in a context, not a store).
  const stateRef = useRef({ tabsHydrated, openTab })
  useEffect(() => {
    stateRef.current = { tabsHydrated, openTab }
  }, [tabsHydrated, openTab])

  // Holds the latest focus request until the workspace has hydrated. The event
  // is one-shot, so a pet-panel click during startup/reload (before folders &
  // tabs hydrate) must not be dropped — replay it once hydration completes.
  const pendingRef = useRef<FocusRequest | null>(null)

  const attempt = useCallback(() => {
    const req = pendingRef.current
    if (!req) return
    const workspace = useAppWorkspaceStore.getState()
    if (!workspace.foldersHydrated || !stateRef.current.tabsHydrated) return
    // One-shot after hydration (mirrors DeepLinkBootstrap): clear before the
    // async work so a later state change can't double-open.
    pendingRef.current = null
    void (async () => {
      // Ensure the folder is in the workspace so the tab has a home.
      if (!workspace.folders.some((f) => f.id === req.folderId)) {
        try {
          await workspace.addFolderToWorkspaceById(req.folderId)
        } catch (err) {
          console.error("[PetFocusBridge] open folder failed:", err)
          return
        }
      }
      // The event is backend-originated for a live session, so the conversation
      // exists; open the tab directly and let its title/content hydrate. We do
      // NOT gate on the conversations list — it loads independently of folders,
      // and waiting on it (without a ready flag) would drop the request.
      stateRef.current.openTab(
        req.folderId,
        req.conversationId,
        req.agent,
        true
      )
    })()
  }, [])

  // Replay a queued request once hydration flips ready.
  useEffect(() => {
    attempt()
  }, [foldersHydrated, tabsHydrated, attempt])

  useEffect(() => {
    let dispose: (() => void) | null = null
    let cancelled = false

    void (async () => {
      try {
        const { getTransport } = await import("@/lib/transport")
        const off = await getTransport().subscribe<{
          folderId?: number
          conversationId?: number
          agent?: string
        }>("workspace://focus-conversation", (payload) => {
          const folderId = Number(payload?.folderId)
          const conversationId = Number(payload?.conversationId)
          const agent = payload?.agent as AgentType | undefined
          if (
            !Number.isFinite(folderId) ||
            !Number.isFinite(conversationId) ||
            !agent
          ) {
            return
          }
          pendingRef.current = { folderId, conversationId, agent }
          attempt()
        })
        if (cancelled) off()
        else dispose = off
      } catch (err) {
        console.warn("[PetFocusBridge] subscription failed:", err)
      }
    })()

    return () => {
      cancelled = true
      if (dispose) dispose()
    }
  }, [attempt])

  return null
}
