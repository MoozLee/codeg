"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useTranslations } from "next-intl"
import { getSystemTerminalSettings, terminalKill } from "@/lib/api"
import { getTransport } from "@/lib/transport"
import { randomUUID } from "@/lib/utils"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useTabContext, type TabItem } from "@/contexts/tab-context"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { matchShortcutEvent } from "@/lib/keyboard-shortcuts"

export interface TerminalPane {
  id: string
  title?: string
  workingDir: string
  shell?: string
  initialCommand?: string
}

export type TerminalOwner =
  | {
      kind: "conversation"
      conversationId: number
    }
  | {
      kind: "tab"
      conversationTabId: string
    }

export interface TerminalTab {
  id: string
  folderId: number
  title: string
  owner: TerminalOwner | null
  panes: TerminalPane[]
  activePaneId: string
}

const DEFAULT_HEIGHT = 300
const MIN_HEIGHT = 150
const MAX_HEIGHT = 600
const TERMINAL_SETTINGS_UPDATED_EVENT = "app://terminal-settings-updated"

interface TerminalContextValue {
  isOpen: boolean
  height: number
  minHeight: number
  maxHeight: number
  toggle: () => void
  setHeight: (h: number) => void
  tabs: TerminalTab[]
  visibleTabs: TerminalTab[]
  activeTabId: string | null
  activeVisibleTabId: string | null
  activePaneId: string | null
  exitedTerminals: Set<string>
  markTerminalExited: (id: string) => void
  createTerminal: () => Promise<void>
  createTerminalInDirectory: (
    workingDir: string,
    title?: string,
    shell?: string
  ) => Promise<string | null>
  createTerminalWithCommand: (
    title: string,
    command: string
  ) => Promise<string | null>
  splitTerminal: () => Promise<string | null>
  closeTerminal: (id: string) => void
  closeOtherTerminals: (id: string) => void
  closeAllTerminals: () => void
  closePane: (tabId: string, paneId: string) => void
  closeOtherPanes: (tabId: string, paneId: string) => void
  closeAllPanes: (tabId: string) => void
  closeTerminalsByFolder: (folderId: number) => void
  renameTerminal: (id: string, title: string) => void
  renamePane: (tabId: string, paneId: string, title: string) => void
  switchTerminal: (id: string) => void
  switchPane: (tabId: string, paneId: string) => void
}

const TerminalContext = createContext<TerminalContextValue | null>(null)

function getTerminalOwnerFromConversationTab(
  tab: TabItem | null
): TerminalOwner | null {
  if (!tab) return null
  if (tab.conversationId != null) {
    return {
      kind: "conversation",
      conversationId: tab.conversationId,
    }
  }
  return {
    kind: "tab",
    conversationTabId: tab.id,
  }
}

function resolveTerminalOwner(
  owner: TerminalOwner | null,
  conversationIdsByTabId: ReadonlyMap<string, number>
): TerminalOwner | null {
  if (owner?.kind !== "tab") return owner
  const conversationId = conversationIdsByTabId.get(owner.conversationTabId)
  if (conversationId == null) return owner
  return {
    kind: "conversation",
    conversationId,
  }
}

function isSameOwner(
  a: TerminalOwner | null,
  b: TerminalOwner | null
): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === "conversation" && b.kind === "conversation") {
    return a.conversationId === b.conversationId
  }
  if (a.kind === "tab" && b.kind === "tab") {
    return a.conversationTabId === b.conversationTabId
  }
  return false
}

function matchesConversationTab(
  terminalTab: TerminalTab,
  conversationTab: TabItem | null
): boolean {
  if (!conversationTab) return terminalTab.owner == null
  if (!terminalTab.owner) return false

  if (terminalTab.owner.kind === "conversation") {
    return terminalTab.owner.conversationId === conversationTab.conversationId
  }

  return terminalTab.owner.conversationTabId === conversationTab.id
}

function collectPaneIds(terminalTabs: TerminalTab[]): string[] {
  return terminalTabs.flatMap((tab) => tab.panes.map((pane) => pane.id))
}

function createTerminalPane(
  workingDir: string,
  shell?: string,
  initialCommand?: string,
  title?: string
): TerminalPane {
  return {
    id: randomUUID(),
    title,
    workingDir,
    shell,
    initialCommand,
  }
}

export function useTerminalContext() {
  const ctx = useContext(TerminalContext)
  if (!ctx) {
    throw new Error("useTerminalContext must be used within TerminalProvider")
  }
  return ctx
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("Folder.terminal")
  const { activeFolder, activeFolderId } = useActiveFolder()
  const {
    tabs: conversationTabs,
    activeTabId: activeConversationTabId,
    activeTabActivationSeq,
  } = useTabContext()
  const { shortcuts } = useShortcutSettings()
  const [isOpen, setIsOpen] = useState(false)
  const [height, setHeightState] = useState(DEFAULT_HEIGHT)
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const tabCounterRef = useRef(0)
  const [exitedTerminals, setExitedTerminals] = useState<Set<string>>(new Set())
  const [defaultTerminalShell, setDefaultTerminalShell] = useState<
    string | null
  >(null)
  const lastMouseActivityInTerminalRef = useRef(false)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const activeConversationTabRef = useRef<TabItem | null>(null)
  const [manualSelection, setManualSelection] = useState<{
    conversationKey: string | null
    conversationTabId: string | null
    activationSeq: number
  } | null>(null)

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const activeConversationTab = useMemo(
    () =>
      conversationTabs.find((tab) => tab.id === activeConversationTabId) ??
      null,
    [conversationTabs, activeConversationTabId]
  )

  const conversationIdsByTabId = useMemo(
    () =>
      new Map(
        conversationTabs
          .filter((tab) => tab.conversationId != null)
          .map((tab) => [tab.id, tab.conversationId as number] as const)
      ),
    [conversationTabs]
  )

  const resolvedTabs = useMemo(
    () =>
      tabs.map((tab) => ({
        ...tab,
        owner: resolveTerminalOwner(tab.owner, conversationIdsByTabId),
      })),
    [tabs, conversationIdsByTabId]
  )

  const activeConversationKey = useMemo(() => {
    if (!activeConversationTab) return null
    if (activeConversationTab.conversationId != null) {
      return `conversation:${activeConversationTab.conversationId}`
    }
    return `tab:${activeConversationTab.id}`
  }, [activeConversationTab])

  useEffect(() => {
    activeConversationTabRef.current = activeConversationTab
  }, [activeConversationTab])

  const folderPath = activeFolder?.path ?? ""
  const currentFolderId = activeFolderId ?? 0
  const resolveTerminalShell = useCallback(
    (shell?: string) => shell ?? defaultTerminalShell ?? undefined,
    [defaultTerminalShell]
  )

  const visibleTabs = useMemo(
    () =>
      resolvedTabs.filter((tab) =>
        matchesConversationTab(tab, activeConversationTab)
      ),
    [resolvedTabs, activeConversationTab]
  )

  const activeVisibleTabId = useMemo(() => {
    if (visibleTabs.length === 0) return null

    const activeConversationTabId = activeConversationTab?.id ?? null
    const manualConversationTabId = manualSelection?.conversationTabId ?? null
    const manualConversationId =
      manualConversationTabId != null
        ? (conversationIdsByTabId.get(manualConversationTabId) ?? null)
        : null
    const resolvedManualConversationKey =
      manualConversationTabId != null
        ? manualConversationId != null
          ? `conversation:${manualConversationId}`
          : `tab:${manualConversationTabId}`
        : (manualSelection?.conversationKey ?? null)
    const sameConversationScope =
      manualSelection?.activationSeq === activeTabActivationSeq &&
      (manualSelection.conversationTabId === activeConversationTabId ||
        resolvedManualConversationKey === activeConversationKey)
    const canReuseManualSelection =
      sameConversationScope &&
      activeTabId != null &&
      visibleTabs.some((tab) => tab.id === activeTabId)

    return canReuseManualSelection ? activeTabId : (visibleTabs[0]?.id ?? null)
  }, [
    activeConversationKey,
    activeConversationTab,
    activeTabActivationSeq,
    activeTabId,
    conversationIdsByTabId,
    manualSelection,
    visibleTabs,
  ])

  const activePaneId = useMemo(() => {
    const activeVisibleTab = visibleTabs.find(
      (tab) => tab.id === activeVisibleTabId
    )
    return activeVisibleTab?.activePaneId ?? null
  }, [activeVisibleTabId, visibleTabs])

  const livePaneIds = useMemo(
    () => new Set(collectPaneIds(resolvedTabs)),
    [resolvedTabs]
  )

  const visibleExitedTerminals = useMemo(() => {
    if (exitedTerminals.size === 0) return exitedTerminals
    const next = new Set<string>()
    for (const id of exitedTerminals) {
      if (livePaneIds.has(id)) next.add(id)
    }
    return next
  }, [exitedTerminals, livePaneIds])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    getSystemTerminalSettings()
      .then((settings) => {
        if (!cancelled) setDefaultTerminalShell(settings.default_shell)
      })
      .catch((err) => {
        console.error("[terminal] load terminal settings failed:", err)
      })

    getTransport()
      .subscribe<{ default_shell: string | null }>(
        TERMINAL_SETTINGS_UPDATED_EVENT,
        (settings) => {
          setDefaultTerminalShell(settings.default_shell)
        }
      )
      .then((dispose) => {
        if (cancelled) {
          dispose()
          return
        }
        unlisten = dispose
      })
      .catch((err) => {
        console.error("[terminal] subscribe terminal settings failed:", err)
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const markTerminalExited = useCallback((id: string) => {
    setExitedTerminals((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const removeExitedTerminals = useCallback((ids: string[]) => {
    setExitedTerminals((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Set(prev)
      for (const id of ids) {
        if (next.delete(id)) changed = true
      }
      return changed ? next : prev
    })
  }, [])

  const killTerminalTabs = useCallback((targetTabs: TerminalTab[]) => {
    targetTabs.forEach((tab) => {
      tab.panes.forEach((pane) => {
        terminalKill(pane.id).catch(() => {})
      })
    })
  }, [])

  const createOwnedTerminalTab = useCallback(
    ({
      folderId,
      title,
      workingDir,
      shell,
      initialCommand,
    }: {
      folderId: number
      title: string
      workingDir: string
      shell?: string
      initialCommand?: string
    }) => {
      const pane = createTerminalPane(workingDir, shell, initialCommand)
      const tabId = randomUUID()
      const owner = getTerminalOwnerFromConversationTab(
        activeConversationTabRef.current
      )

      const tab: TerminalTab = {
        id: tabId,
        folderId,
        title,
        owner,
        panes: [pane],
        activePaneId: pane.id,
      }

      setManualSelection({
        conversationKey: activeConversationKey,
        conversationTabId: activeConversationTabRef.current?.id ?? null,
        activationSeq: activeTabActivationSeq,
      })
      setTabs((prev) => [...prev, tab])
      setActiveTabId(tabId)
      return pane.id
    },
    [activeConversationKey, activeTabActivationSeq]
  )

  const toggle = useCallback(() => {
    const nextCounter = tabCounterRef.current + 1
    const defaultTitle = t("defaultTitle", { number: nextCounter })
    const resolvedShell = resolveTerminalShell()
    const shouldAutoCreate = tabsRef.current.length === 0 && Boolean(folderPath)
    const autoPane = shouldAutoCreate
      ? createTerminalPane(folderPath, resolvedShell)
      : null
    const autoTabId = shouldAutoCreate ? randomUUID() : null

    setIsOpen((wasOpen) => !wasOpen)

    setTabs((currentTabs) => {
      if (
        !shouldAutoCreate ||
        !autoPane ||
        !autoTabId ||
        currentTabs.length > 0
      ) {
        return currentTabs
      }

      tabCounterRef.current = nextCounter
      return [
        {
          id: autoTabId,
          folderId: currentFolderId,
          title: defaultTitle,
          owner: getTerminalOwnerFromConversationTab(
            activeConversationTabRef.current
          ),
          panes: [autoPane],
          activePaneId: autoPane.id,
        },
      ]
    })

    setActiveTabId((prev) => prev ?? autoTabId)
  }, [currentFolderId, folderPath, resolveTerminalShell, t])

  const createTerminalWithCommand = useCallback(
    async (title: string, command: string) => {
      if (!folderPath) return null

      setIsOpen(true)

      const paneId = createOwnedTerminalTab({
        folderId: currentFolderId,
        title,
        workingDir: folderPath,
        shell: resolveTerminalShell(),
        initialCommand: command,
      })

      return paneId
    },
    [createOwnedTerminalTab, folderPath, currentFolderId, resolveTerminalShell]
  )

  const createTerminalInDirectory = useCallback(
    async (workingDir: string, title?: string, shell?: string) => {
      if (!workingDir) return null

      setIsOpen(true)

      tabCounterRef.current += 1
      const defaultTitle = t("defaultTitle", {
        number: tabCounterRef.current,
      })
      const paneId = createOwnedTerminalTab({
        folderId: currentFolderId,
        title: title ?? defaultTitle,
        workingDir,
        shell: resolveTerminalShell(shell),
      })

      return paneId
    },
    [createOwnedTerminalTab, currentFolderId, resolveTerminalShell, t]
  )

  const createTerminal = useCallback(async () => {
    if (!folderPath) return
    await createTerminalInDirectory(folderPath)
  }, [folderPath, createTerminalInDirectory])

  const splitTerminal = useCallback(async () => {
    const targetTabId =
      activeVisibleTabId ??
      activeTabIdRef.current ??
      tabsRef.current[0]?.id ??
      null
    if (!targetTabId) return null

    const targetTab = tabsRef.current.find((tab) => tab.id === targetTabId)
    if (!targetTab) return null

    const activePane =
      targetTab.panes.find((pane) => pane.id === targetTab.activePaneId) ??
      targetTab.panes[0]
    if (!activePane) return null

    const nextPane = createTerminalPane(
      activePane.workingDir,
      activePane.shell,
      undefined
    )

    setManualSelection({
      conversationKey: activeConversationKey,
      conversationTabId: activeConversationTabRef.current?.id ?? null,
      activationSeq: activeTabActivationSeq,
    })
    setIsOpen(true)
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === targetTab.id
          ? {
              ...tab,
              panes: [...tab.panes, nextPane],
              activePaneId: nextPane.id,
            }
          : tab
      )
    )
    setActiveTabId(targetTab.id)

    return nextPane.id
  }, [activeConversationKey, activeTabActivationSeq, activeVisibleTabId])

  const setHeight = useCallback((h: number) => {
    setHeightState(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h)))
  }, [])

  const closeTerminal = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const index = prev.findIndex((tab) => tab.id === id)
        if (index < 0) return prev

        const closingTab = prev[index]
        const next = prev.filter((tab) => tab.id !== id)
        const closingPaneIds = closingTab.panes.map((pane) => pane.id)

        killTerminalTabs([closingTab])
        removeExitedTerminals(closingPaneIds)

        if (next.length === 0) {
          tabCounterRef.current = 0
          setIsOpen(false)
          setActiveTabId(null)
          return next
        }

        const resolvedClosingOwner = resolveTerminalOwner(
          closingTab.owner,
          conversationIdsByTabId
        )
        const sameOwner = next.filter((tab) =>
          isSameOwner(
            resolveTerminalOwner(tab.owner, conversationIdsByTabId),
            resolvedClosingOwner
          )
        )
        const fallbackTab = sameOwner[0] ?? next[next.length - 1]

        if (activeTabIdRef.current === id) {
          setActiveTabId(fallbackTab.id)
        }

        return next
      })
    },
    [conversationIdsByTabId, killTerminalTabs, removeExitedTerminals]
  )

  const closeOtherTerminals = useCallback(
    (id: string) => {
      const scopeIds = new Set(visibleTabs.map((tab) => tab.id))
      if (scopeIds.size <= 1) return

      setManualSelection({
        conversationKey: activeConversationKey,
        conversationTabId: activeConversationTabRef.current?.id ?? null,
        activationSeq: activeTabActivationSeq,
      })
      setTabs((prev) => {
        const closed = prev.filter(
          (tab) => scopeIds.has(tab.id) && tab.id !== id
        )
        if (closed.length === 0) return prev

        killTerminalTabs(closed)
        removeExitedTerminals(collectPaneIds(closed))
        return prev.filter((tab) => !scopeIds.has(tab.id) || tab.id === id)
      })
      setActiveTabId(id)
    },
    [
      activeConversationKey,
      activeTabActivationSeq,
      killTerminalTabs,
      removeExitedTerminals,
      visibleTabs,
    ]
  )

  const closeAllTerminals = useCallback(() => {
    const scopeIds = new Set(visibleTabs.map((tab) => tab.id))
    if (scopeIds.size === 0) return

    setTabs((prev) => {
      const closed = prev.filter((tab) => scopeIds.has(tab.id))
      if (closed.length === 0) return prev

      const next = prev.filter((tab) => !scopeIds.has(tab.id))
      killTerminalTabs(closed)
      removeExitedTerminals(collectPaneIds(closed))

      if (next.length === 0) {
        tabCounterRef.current = 0
        setActiveTabId(null)
        setIsOpen(false)
      } else if (
        activeTabIdRef.current &&
        scopeIds.has(activeTabIdRef.current)
      ) {
        setActiveTabId(next[next.length - 1].id)
      }

      return next
    })
  }, [killTerminalTabs, removeExitedTerminals, visibleTabs])

  const closePane = useCallback(
    (tabId: string, paneId: string) => {
      const targetTab = tabsRef.current.find((tab) => tab.id === tabId)
      if (!targetTab) return
      if (targetTab.panes.length <= 1) {
        closeTerminal(tabId)
        return
      }

      terminalKill(paneId).catch(() => {})
      removeExitedTerminals([paneId])
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) return tab

          const nextPanes = tab.panes.filter((pane) => pane.id !== paneId)
          const nextActivePaneId =
            tab.activePaneId === paneId
              ? (nextPanes[0]?.id ?? tab.activePaneId)
              : tab.activePaneId

          return {
            ...tab,
            panes: nextPanes,
            activePaneId: nextActivePaneId,
          }
        })
      )
    },
    [closeTerminal, removeExitedTerminals]
  )

  const closeOtherPanes = useCallback(
    (tabId: string, paneId: string) => {
      const targetTab = tabsRef.current.find((tab) => tab.id === tabId)
      if (!targetTab || targetTab.panes.length <= 1) return

      const paneIdsToClose = targetTab.panes
        .filter((pane) => pane.id !== paneId)
        .map((pane) => pane.id)
      if (paneIdsToClose.length === 0) return

      paneIdsToClose.forEach((id) => {
        terminalKill(id).catch(() => {})
      })
      removeExitedTerminals(paneIdsToClose)
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) return tab
          const remainingPane =
            tab.panes.find((pane) => pane.id === paneId) ?? tab.panes[0]
          if (!remainingPane) return tab
          return {
            ...tab,
            panes: [remainingPane],
            activePaneId: remainingPane.id,
          }
        })
      )
      setActiveTabId(tabId)
    },
    [removeExitedTerminals]
  )

  const closeAllPanes = useCallback(
    (tabId: string) => {
      closeTerminal(tabId)
    },
    [closeTerminal]
  )

  const closeTerminalsByFolder = useCallback(
    (folderId: number) => {
      setTabs((prev) => {
        const closed = prev.filter((tab) => tab.folderId === folderId)
        if (closed.length === 0) return prev

        const next = prev.filter((tab) => tab.folderId !== folderId)
        killTerminalTabs(closed)
        removeExitedTerminals(collectPaneIds(closed))

        if (next.length === 0) {
          tabCounterRef.current = 0
          setActiveTabId(null)
          setIsOpen(false)
        } else if (
          activeTabIdRef.current &&
          closed.some((tab) => tab.id === activeTabIdRef.current)
        ) {
          setActiveTabId(next[next.length - 1].id)
        }

        return next
      })
    },
    [killTerminalTabs, removeExitedTerminals]
  )

  const renameTerminal = useCallback((id: string, title: string) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === id ? { ...tab, title } : tab))
    )
  }, [])

  const renamePane = useCallback(
    (tabId: string, paneId: string, title: string) => {
      const normalizedTitle = title.trim()
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) return tab
          return {
            ...tab,
            panes: tab.panes.map((pane) =>
              pane.id === paneId
                ? {
                    ...pane,
                    title: normalizedTitle || undefined,
                  }
                : pane
            ),
          }
        })
      )
    },
    []
  )

  const switchTerminal = useCallback(
    (id: string) => {
      setManualSelection({
        conversationKey: activeConversationKey,
        conversationTabId: activeConversationTabRef.current?.id ?? null,
        activationSeq: activeTabActivationSeq,
      })
      setActiveTabId(id)
    },
    [activeConversationKey, activeTabActivationSeq]
  )

  const switchPane = useCallback(
    (tabId: string, paneId: string) => {
      setManualSelection({
        conversationKey: activeConversationKey,
        conversationTabId: activeConversationTabRef.current?.id ?? null,
        activationSeq: activeTabActivationSeq,
      })
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId ? { ...tab, activePaneId: paneId } : tab
        )
      )
      setActiveTabId(tabId)
    },
    [activeConversationKey, activeTabActivationSeq]
  )

  const isInTerminalRegion = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    return Boolean(target.closest('[data-terminal-panel-region="true"]'))
  }, [])

  const updateLastMouseActivity = useCallback(
    (target: EventTarget | null) => {
      const next = isInTerminalRegion(target)
      if (lastMouseActivityInTerminalRef.current === next) return
      lastMouseActivityInTerminalRef.current = next
    },
    [isInTerminalRegion]
  )

  useEffect(() => {
    const handlePointerActivity = (event: PointerEvent) => {
      updateLastMouseActivity(event.target)
    }
    const handleFocusActivity = (event: FocusEvent) => {
      updateLastMouseActivity(event.target)
    }

    window.addEventListener("pointerover", handlePointerActivity, true)
    window.addEventListener("pointerdown", handlePointerActivity, true)
    window.addEventListener("focusin", handleFocusActivity, true)
    return () => {
      window.removeEventListener("pointerover", handlePointerActivity, true)
      window.removeEventListener("pointerdown", handlePointerActivity, true)
      window.removeEventListener("focusin", handleFocusActivity, true)
    }
  }, [updateLastMouseActivity])

  useEffect(() => {
    if (!isOpen) {
      lastMouseActivityInTerminalRef.current = false
    }
  }, [isOpen])

  useEffect(() => {
    const handleTerminalHotkeys = (event: KeyboardEvent) => {
      if (!isOpen) return

      const targetInTerminal = isInTerminalRegion(event.target)
      const activeElementInTerminal = isInTerminalRegion(document.activeElement)
      const shouldHandle =
        lastMouseActivityInTerminalRef.current ||
        targetInTerminal ||
        activeElementInTerminal
      if (!shouldHandle) return

      if (matchShortcutEvent(event, shortcuts.new_terminal_tab)) {
        event.preventDefault()
        event.stopPropagation()
        void createTerminal()
        return
      }

      if (
        activeVisibleTabId &&
        matchShortcutEvent(event, shortcuts.close_current_terminal_tab)
      ) {
        event.preventDefault()
        event.stopPropagation()
        closeTerminal(activeVisibleTabId)
      }
    }

    window.addEventListener("keydown", handleTerminalHotkeys, true)
    return () => {
      window.removeEventListener("keydown", handleTerminalHotkeys, true)
    }
  }, [
    activeVisibleTabId,
    closeTerminal,
    createTerminal,
    isInTerminalRegion,
    isOpen,
    shortcuts.close_current_terminal_tab,
    shortcuts.new_terminal_tab,
  ])

  useEffect(() => {
    return () => {
      tabsRef.current.forEach((tab) => {
        tab.panes.forEach((pane) => {
          terminalKill(pane.id).catch(() => {})
        })
      })
    }
  }, [])

  const value = useMemo(
    () => ({
      isOpen,
      height,
      minHeight: MIN_HEIGHT,
      maxHeight: MAX_HEIGHT,
      toggle,
      setHeight,
      tabs: resolvedTabs,
      visibleTabs,
      activeTabId,
      activeVisibleTabId,
      activePaneId,
      exitedTerminals: visibleExitedTerminals,
      markTerminalExited,
      createTerminal,
      createTerminalInDirectory,
      createTerminalWithCommand,
      splitTerminal,
      closeTerminal,
      closeOtherTerminals,
      closeAllTerminals,
      closePane,
      closeOtherPanes,
      closeAllPanes,
      closeTerminalsByFolder,
      renameTerminal,
      renamePane,
      switchTerminal,
      switchPane,
    }),
    [
      isOpen,
      height,
      toggle,
      setHeight,
      resolvedTabs,
      visibleTabs,
      activeTabId,
      activeVisibleTabId,
      activePaneId,
      visibleExitedTerminals,
      markTerminalExited,
      createTerminal,
      createTerminalInDirectory,
      createTerminalWithCommand,
      splitTerminal,
      closeTerminal,
      closeOtherTerminals,
      closeAllTerminals,
      closePane,
      closeOtherPanes,
      closeAllPanes,
      closeTerminalsByFolder,
      renameTerminal,
      renamePane,
      switchTerminal,
      switchPane,
    ]
  )

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  )
}
