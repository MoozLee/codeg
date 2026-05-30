"use client"

import { useEffect } from "react"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import { useTabContext } from "@/contexts/tab-context"
import { subscribe } from "@/lib/platform"
import { FOLDER_OPEN_IN_WORKSPACE_EVENT } from "@/lib/api"
import type { FolderDetail } from "@/lib/types"

export function WorkspaceOpenFolderListener() {
  const { upsertFolder, setBranch, refreshConversations } = useAppWorkspace()
  const { openNewConversationTab, tabPersistenceMode } = useTabContext()

  useEffect(() => {
    if (tabPersistenceMode !== "shared") return

    let disposed = false
    let unlisten: (() => void) | undefined

    void (async () => {
      const dispose = await subscribe<FolderDetail>(
        FOLDER_OPEN_IN_WORKSPACE_EVENT,
        (detail) => {
          upsertFolder(detail)
          setBranch(detail.id, detail.git_branch ?? null)
          openNewConversationTab(detail.id, detail.path)
          void refreshConversations()
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
  }, [
    tabPersistenceMode,
    upsertFolder,
    setBranch,
    refreshConversations,
    openNewConversationTab,
  ])

  return null
}
