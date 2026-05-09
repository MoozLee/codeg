"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Reorder } from "motion/react"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import { useTabContext } from "@/contexts/tab-context"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { useOpenConversation } from "@/hooks/use-open-conversation"
import { matchShortcutEvent } from "@/lib/keyboard-shortcuts"
import { TabItem } from "./tab-item"
import { cn } from "@/lib/utils"

export function TabBar() {
  const {
    tabs,
    activeTabId,
    isTileMode,
    switchTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    pinTab,
    toggleTileMode,
    reorderTabs,
  } = useTabContext()
  const { allFolders, branches } = useAppWorkspace()
  const { mode, activePane } = useWorkspaceContext()
  const openConversation = useOpenConversation()

  const folderIndex = useMemo(() => {
    const map = new Map<number, { name: string }>()
    for (const f of allFolders) map.set(f.id, { name: f.name })
    return map
  }, [allFolders])

  const { shortcuts } = useShortcutSettings()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0 && scrollRef.current) {
      e.preventDefault()
      scrollRef.current.scrollLeft += e.deltaY
    }
  }, [])

  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return
    const el = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`)
    el?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeTabId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shouldHandleShortcut =
        mode === "conversation" ||
        (mode === "fusion" && activePane === "conversation")
      if (!shouldHandleShortcut) return
      if (!matchShortcutEvent(event, shortcuts.close_current_tab)) return
      if (!activeTabId) return

      event.preventDefault()
      closeTab(activeTabId)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [activePane, activeTabId, closeTab, mode, shortcuts.close_current_tab])

  const handleOpenInWindow = useCallback(
    (tab: (typeof tabs)[number]) => {
      if (tab.conversationId == null) return
      void openConversation({
        folderId: tab.folderId,
        conversationId: tab.conversationId,
        agentType: tab.agentType,
        pin: true,
        explicitWindow: true,
      })
    },
    [openConversation]
  )

  if (tabs.length === 0) return null

  return (
    <Reorder.Group
      as="div"
      ref={scrollRef}
      role="tablist"
      axis="x"
      values={tabs}
      onReorder={reorderTabs}
      onWheel={handleWheel}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "h-10 pt-1.5 px-1.5 flex items-stretch gap-1.5 border-b border-border",
        "overflow-x-scroll",
        isHovered
          ? [
              "pb-0.5",
              "[&::-webkit-scrollbar]:h-1",
              "[&::-webkit-scrollbar-track]:bg-transparent",
              "[&::-webkit-scrollbar-thumb]:rounded-full",
              "[&::-webkit-scrollbar-thumb]:bg-border",
            ]
          : ["pb-1.5", "[&::-webkit-scrollbar]:h-0"]
      )}
    >
      {tabs.map((tab) => {
        const folderInfo = folderIndex.get(tab.folderId)
        return (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            isTileMode={isTileMode}
            folderName={folderInfo?.name ?? null}
            folderBranch={branches.get(tab.folderId) ?? null}
            onSwitch={switchTab}
            onClose={closeTab}
            onCloseOthers={closeOtherTabs}
            onCloseAll={closeAllTabs}
            onPin={pinTab}
            onToggleTile={toggleTileMode}
            onOpenInWindow={handleOpenInWindow}
          />
        )
      })}
    </Reorder.Group>
  )
}
