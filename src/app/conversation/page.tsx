"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { AppTitleBar } from "@/components/layout/app-title-bar"
import { ConversationDetailPanel } from "@/components/conversations/conversation-detail-panel"
import { AppToaster } from "@/components/ui/app-toaster"
import {
  AppWorkspaceProvider,
  ConversationStatusEventBridge,
  useAppWorkspace,
} from "@/contexts/app-workspace-context"
import { ActiveFolderProvider } from "@/contexts/active-folder-context"
import { AlertProvider } from "@/contexts/alert-context"
import { GitCredentialProvider } from "@/contexts/git-credential-context"
import { TaskProvider } from "@/contexts/task-context"
import { AcpConnectionsProvider } from "@/contexts/acp-connections-context"
import { ConversationRuntimeProvider } from "@/contexts/conversation-runtime-context"
import { WorkspaceProvider } from "@/contexts/workspace-context"
import { SessionStatsProvider } from "@/contexts/session-stats-context"
import { ConversationWindowTabProvider } from "@/contexts/conversation-window-tab-context"
import { getFolderConversation } from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import type { AgentType, DbConversationSummary } from "@/lib/types"
import { Loader2 } from "lucide-react"

const TOAST_DURATION_MS = 8000

function ConversationPageInner() {
  const tConversation = useTranslations("ConversationPage")
  const tTab = useTranslations("Folder.tabContext")
  const searchParams = useSearchParams()
  const conversationId = Number(searchParams.get("conversationId") ?? "0")
  const hasValidConversationId =
    Number.isFinite(conversationId) && conversationId > 0
  const [summary, setSummary] = useState<DbConversationSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(hasValidConversationId)
  const { setActiveFolderId } = useAppWorkspace()

  useEffect(() => {
    if (!hasValidConversationId) return

    let cancelled = false

    void (async () => {
      setLoading(true)
      setError(null)

      try {
        const detail = await getFolderConversation(conversationId)
        if (cancelled) return
        setSummary(detail.summary)
        setActiveFolderId(detail.summary.folder_id)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setSummary(null)
        setError(toErrorMessage(err))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [conversationId, hasValidConversationId, setActiveFolderId])

  useEffect(() => {
    if (!hasValidConversationId || !summary) {
      document.title = `${tConversation("title")} - codeg`
      return
    }
    document.title = `${summary.title || tTab("untitledConversation")} - codeg`
  }, [hasValidConversationId, summary, tConversation, tTab])

  const shell = useMemo(() => {
    if (!summary) return null
    return (
      <ConversationWindowTabProvider
        folderId={summary.folder_id}
        conversationId={summary.id}
        agentType={summary.agent_type as AgentType}
        title={summary.title || tTab("untitledConversation")}
      >
        <ConversationDetailPanel allowNewConversation={false} />
      </ConversationWindowTabProvider>
    )
  }, [summary, tTab])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppTitleBar
        center={
          <div className="max-w-[60vw] truncate text-sm font-semibold tracking-tight">
            {summary?.title || tConversation("title")}
          </div>
        }
      />
      <main className="min-h-0 flex-1 overflow-hidden">
        {!hasValidConversationId ? (
          <div className="p-4 text-sm text-destructive">
            {tConversation("invalidConversationId")}
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {tConversation("loadingConversation")}
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{error}</div>
        ) : (
          shell
        )}
      </main>
      <AppToaster
        position="bottom-right"
        duration={TOAST_DURATION_MS}
        closeButton
      />
    </div>
  )
}

function ConversationPageProviders() {
  return (
    <AppWorkspaceProvider>
      <ActiveFolderProvider>
        <AlertProvider>
          <GitCredentialProvider>
            <TaskProvider>
              <AcpConnectionsProvider>
                <ConversationStatusEventBridge />
                <ConversationRuntimeProvider>
                  <WorkspaceProvider>
                    <SessionStatsProvider>
                      <ConversationPageInner />
                    </SessionStatsProvider>
                  </WorkspaceProvider>
                </ConversationRuntimeProvider>
              </AcpConnectionsProvider>
            </TaskProvider>
          </GitCredentialProvider>
        </AlertProvider>
      </ActiveFolderProvider>
    </AppWorkspaceProvider>
  )
}

export default function ConversationPage() {
  return (
    <Suspense>
      <ConversationPageProviders />
    </Suspense>
  )
}
