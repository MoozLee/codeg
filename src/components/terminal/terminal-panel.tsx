"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTerminalContext } from "@/contexts/terminal-context"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { TerminalTabBar } from "./terminal-tab-bar"
import { TerminalView } from "./terminal-view"

const TERMINAL_PANE_MIN_WIDTH = 480

export function TerminalPanel() {
  const t = useTranslations("Folder.terminal")
  const {
    isOpen,
    tabs,
    visibleTabs,
    activeVisibleTabId,
    markTerminalExited,
    closePane,
    closeOtherPanes,
    closeAllPanes,
    renamePane,
    switchPane,
  } = useTerminalContext()

  const activeTab = useMemo(
    () => visibleTabs.find((tab) => tab.id === activeVisibleTabId) ?? null,
    [visibleTabs, activeVisibleTabId]
  )
  const activePaneId = activeTab?.activePaneId ?? null
  const multiPane = (activeTab?.panes.length ?? 0) > 1
  const activePaneRef = useRef<HTMLDivElement | null>(null)
  const paneInputRef = useRef<HTMLInputElement>(null)
  const [editingPaneTabId, setEditingPaneTabId] = useState<string | null>(null)
  const [editingPaneId, setEditingPaneId] = useState<string | null>(null)
  const [editingPaneValue, setEditingPaneValue] = useState("")

  useEffect(() => {
    if (!multiPane || !activePaneRef.current) return
    activePaneRef.current.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    })
  }, [activePaneId, multiPane])

  useEffect(() => {
    if (!editingPaneId) return
    const timer = window.setTimeout(() => {
      paneInputRef.current?.focus()
      paneInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editingPaneId])

  const getPaneLabel = (index: number, title?: string) =>
    title?.trim() || t("paneLabel", { number: index + 1 })

  const startRenamePane = (
    tabId: string,
    paneId: string,
    currentTitle?: string | null
  ) => {
    setEditingPaneTabId(tabId)
    setEditingPaneId(paneId)
    setEditingPaneValue(currentTitle ?? "")
  }

  const commitRenamePane = () => {
    if (!editingPaneTabId || !editingPaneId) {
      setEditingPaneTabId(null)
      setEditingPaneId(null)
      setEditingPaneValue("")
      return
    }

    renamePane(editingPaneTabId, editingPaneId, editingPaneValue)
    setEditingPaneTabId(null)
    setEditingPaneId(null)
    setEditingPaneValue("")
  }

  const cancelRenamePane = () => {
    setEditingPaneTabId(null)
    setEditingPaneId(null)
    setEditingPaneValue("")
  }

  return (
    <section
      data-terminal-panel-region="true"
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <TerminalTabBar />
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {tabs.length > 0 && (
          <div className="absolute inset-0 flex min-h-0 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-hidden">
              <ScrollArea
                className="h-full"
                x={multiPane ? "scroll" : "hidden"}
                y="hidden"
              >
                <div className="relative flex h-full min-h-0 min-w-full gap-3 p-2">
                  {tabs.flatMap((tab) =>
                    tab.panes.map((pane) => {
                      const belongsToActiveTab = tab.id === activeVisibleTabId
                      const isActivePane =
                        belongsToActiveTab && pane.id === activePaneId
                      const displayPane =
                        belongsToActiveTab && activeTab != null

                      return (
                        <div
                          key={pane.id}
                          ref={isActivePane ? activePaneRef : null}
                          className={cn(
                            displayPane
                              ? "relative h-full min-h-0 overflow-hidden rounded-md border bg-background"
                              : "pointer-events-none absolute inset-0 overflow-hidden opacity-0",
                            displayPane && "shrink-0",
                            isActivePane && "ring-1 ring-primary/40"
                          )}
                          style={
                            displayPane
                              ? {
                                  width: multiPane
                                    ? `${TERMINAL_PANE_MIN_WIDTH}px`
                                    : "100%",
                                }
                              : undefined
                          }
                          onClick={
                            displayPane
                              ? () => switchPane(tab.id, pane.id)
                              : undefined
                          }
                        >
                          <TerminalView
                            terminalId={pane.id}
                            workingDir={pane.workingDir}
                            shell={pane.shell}
                            initialCommand={pane.initialCommand}
                            isActive={isActivePane}
                            isVisible={displayPane && isOpen}
                            onProcessExited={markTerminalExited}
                          />
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            {multiPane && activeTab && (
              <aside className="flex w-44 shrink-0 flex-col border-l bg-muted/30">
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  {t("paneList")}
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  <div className="space-y-1">
                    {activeTab.panes.map((pane, index) => {
                      const isActive = pane.id === activePaneId
                      const paneLabel = getPaneLabel(index, pane.title)
                      const isEditing =
                        pane.id === editingPaneId &&
                        activeTab.id === editingPaneTabId
                      return (
                        <ContextMenu key={pane.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              className={cn(
                                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors",
                                isActive
                                  ? "border-primary/40 bg-background text-foreground"
                                  : "border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground"
                              )}
                            >
                              {isEditing ? (
                                <input
                                  ref={paneInputRef}
                                  type="text"
                                  className="min-w-0 flex-1 rounded border border-primary/50 bg-transparent px-1 py-0.5 text-left text-xs outline-none"
                                  value={editingPaneValue}
                                  onChange={(event) =>
                                    setEditingPaneValue(event.target.value)
                                  }
                                  onBlur={commitRenamePane}
                                  onClick={(event) => event.stopPropagation()}
                                  onContextMenu={(event) =>
                                    event.stopPropagation()
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault()
                                      commitRenamePane()
                                    }
                                    if (event.key === "Escape") {
                                      event.preventDefault()
                                      cancelRenamePane()
                                    }
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 truncate text-left"
                                  onClick={() =>
                                    switchPane(activeTab.id, pane.id)
                                  }
                                  title={paneLabel}
                                >
                                  {paneLabel}
                                </button>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0"
                                onClick={() => closePane(activeTab.id, pane.id)}
                                aria-label={t("closePane", {
                                  number: index + 1,
                                })}
                                title={t("closePane", { number: index + 1 })}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              onSelect={() =>
                                startRenamePane(
                                  activeTab.id,
                                  pane.id,
                                  pane.title
                                )
                              }
                            >
                              {t("rename")}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onSelect={() => closePane(activeTab.id, pane.id)}
                            >
                              {t("close")}
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() =>
                                closeOtherPanes(activeTab.id, pane.id)
                              }
                              disabled={activeTab.panes.length <= 1}
                            >
                              {t("closeOthers")}
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => closeAllPanes(activeTab.id)}
                              disabled={activeTab.panes.length === 0}
                            >
                              {t("closeAll")}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    })}
                  </div>
                </div>
              </aside>
            )}
          </div>
        )}

        {!activeTab && (
          <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
            {t("noTerminalsForConversation")}
          </div>
        )}
      </div>
    </section>
  )
}
