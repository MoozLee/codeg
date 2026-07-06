"use client"

import { useEffect } from "react"
import { useTabActions, useTabContext } from "@/contexts/tab-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { subscribe } from "@/lib/platform"
import { FOLDER_OPEN_IN_WORKSPACE_EVENT } from "@/lib/api"
import type { FolderDetail } from "@/lib/types"

export function WorkspaceOpenFolderListener() {
  const { openNewConversationTab } = useTabActions()
  const { tabPersistenceMode } = useTabContext()
  const { openConversations } = useWorkbenchRoute()

  useEffect(() => {
    if (tabPersistenceMode !== "shared") return

    let disposed = false
    let unlisten: (() => void) | undefined

    void (async () => {
      const dispose = await subscribe<FolderDetail>(
        FOLDER_OPEN_IN_WORKSPACE_EVENT,
        (detail) => {
          const store = useAppWorkspaceStore.getState()
          store.upsertFolder(detail)
          store.setBranch(detail.id, detail.git_branch ?? null)
          // Return to the conversation workspace if a route (e.g. Automations)
          // was covering the content region, else the new tab opens unseen.
          openConversations()
          openNewConversationTab(detail.id, detail.path)
          void store.refreshConversations()
        }
      )
      // The effect may have torn down while the async subscribe was in
      // flight; dispose immediately so we don't leak a subscription.
      if (disposed) dispose()
      else unlisten = dispose
    })()

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [tabPersistenceMode, openNewConversationTab, openConversations])

  return null
}
