"use client"

import { useMemo, useRef, useState } from "react"
import { Columns2, Minus, Plus, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTerminalContext } from "@/contexts/terminal-context"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { useIsMac } from "@/hooks/use-is-mac"
import { formatShortcutLabel } from "@/lib/keyboard-shortcuts"
import { handleMiddleClickClose } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function TerminalTabBar() {
  const t = useTranslations("Folder.terminal")
  const { shortcuts } = useShortcutSettings()
  const isMac = useIsMac()
  const {
    visibleTabs,
    activeVisibleTabId,
    switchTerminal,
    closeTerminal,
    closeOtherTerminals,
    closeAllTerminals,
    renameTerminal,
    createTerminal,
    splitTerminal,
    toggle,
  } = useTerminalContext()
  const { activeFolderId } = useActiveFolder()
  const folders = useAppWorkspaceStore((s) => s.folders)

  const folderIndex = useMemo(() => {
    const map = new Map<number, string>()
    for (const f of folders) map.set(f.id, f.name)
    return map
  }, [folders])

  const canCreateTerminal = activeFolderId != null
  const canSplitTerminal = activeVisibleTabId != null

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const startRename = (id: string, title: string) => {
    setEditingId(id)
    setEditValue(title)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      renameTerminal(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  return (
    <div className="flex h-8 shrink-0 items-center border-b bg-muted/50 px-1">
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {visibleTabs.map((tab) => (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  className={`flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-xs cursor-pointer select-none ${
                    tab.id === activeVisibleTabId
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => switchTerminal(tab.id)}
                  onMouseDown={(event) => {
                    if (editingId === tab.id) return
                    handleMiddleClickClose(event, () => closeTerminal(tab.id))
                  }}
                  title={`${folderIndex.get(tab.folderId) ?? String(tab.folderId)}  —  ${tab.title}`}
                >
                  {editingId === tab.id ? (
                    <input
                      ref={inputRef}
                      className="w-20 rounded border border-primary/50 bg-transparent px-0.5 text-xs outline-none"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename()
                        if (e.key === "Escape") setEditingId(null)
                      }}
                    />
                  ) : (
                    <span className="max-w-[120px] truncate">{tab.title}</span>
                  )}
                  <button
                    type="button"
                    className="ml-1 rounded-sm p-0.5 hover:bg-muted-foreground/20"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTerminal(tab.id)
                    }}
                    aria-label={t("close")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => startRename(tab.id, tab.title)}
                >
                  {t("rename")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => closeTerminal(tab.id)}>
                  {t("close")}
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => closeOtherTerminals(tab.id)}
                  disabled={visibleTabs.length <= 1}
                >
                  {t("closeOthers")}
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => closeAllTerminals()}
                  disabled={visibleTabs.length === 0}
                >
                  {t("closeAll")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => void createTerminal()}
                  disabled={!canCreateTerminal}
                  aria-label={t("newTerminalTab")}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {canCreateTerminal ? t("newTerminalTab") : t("openFolderFirst")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-0.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => void splitTerminal()}
                  disabled={!canSplitTerminal}
                  aria-label={t("splitTerminal")}
                >
                  <Columns2 className="h-3 w-3" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {canSplitTerminal ? t("splitTerminal") : t("selectTerminalFirst")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={toggle}
          title={t("hideTerminal", {
            shortcut: formatShortcutLabel(shortcuts.toggle_terminal, isMac),
          })}
        >
          <Minus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
