"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { ChevronDown, History, ArrowUpIcon } from "lucide-react"
import type { OverlayScrollbarsComponentRef } from "overlayscrollbars-react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { useTabContext } from "@/contexts/tab-context"
import { useConversationRuntime } from "@/contexts/conversation-runtime-context"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useConversationDetail } from "@/hooks/use-conversation-detail"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  buildConversationUserMessagePreview,
  countConversationUserMessageImages,
  emitConversationAnchorScrollRequest,
  getConversationActiveAnchor,
  subscribeConversationAnchorState,
} from "@/lib/conversation-anchor-storage"
import type { MessageTurn } from "@/lib/types"
import { cn } from "@/lib/utils"

const INITIAL_VISIBLE_USER_MESSAGES = 50
const LOAD_MORE_USER_MESSAGES_STEP = 50
const DAY_IN_MS = 86_400_000
const VIEWPORT_VISIBILITY_EPSILON_PX = 1
const USER_MESSAGES_SCROLL_TO_TOP_THRESHOLD_PX = 320

interface UserMessageListItem {
  anchorId: string
  preview: string
  timestamp: string
  sequence: number
  dateGroupKey: string
  dateGroupLabel: string
  timeLabel: string
  dateTimeLabel: string
}

interface UserMessageSequenceGroup {
  key: string
  summary: UserMessageListItem
  messages: UserMessageListItem[]
  dateGroupKey: string
  dateGroupLabel: string
}

interface UserMessageDateGroup {
  key: string
  label: string
  groups: UserMessageSequenceGroup[]
}

function getLocalDaySerial(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_IN_MS
  )
}

function getLocalDateGroupKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function UserMessagesEmptyState({
  title,
  hint,
}: {
  title: string
  hint: string
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <History className="size-5 text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function UserMessagesTabContent({
  conversationId,
}: {
  conversationId: number
}) {
  const t = useTranslations("Folder.auxPanel.userMessages")
  const threadT = useTranslations("Folder.chat.messageThread")
  const locale = useLocale()
  const isMobile = useIsMobile()
  const { activateConversationPane } = useWorkspaceContext()
  const { toggle, isOpen } = useAuxPanelContext()
  const { loading } = useConversationDetail(conversationId)
  const { getTimelineTurns } = useConversationRuntime()
  const [visibleState, setVisibleState] = useState(() => ({
    conversationId,
    count: INITIAL_VISIBLE_USER_MESSAGES,
  }))
  const [showScrollToTop, setShowScrollToTop] = useState(false)
  const scrollViewportRef = useRef<OverlayScrollbarsComponentRef>(null)
  const messageNodeRefs = useRef<Map<string, HTMLElement | null>>(new Map())

  const registerMessageNode = useCallback(
    (anchorId: string) => (node: HTMLElement | null) => {
      if (node) {
        messageNodeRefs.current.set(anchorId, node)
        return
      }
      messageNodeRefs.current.delete(anchorId)
    },
    []
  )

  const activeAnchorId = useSyncExternalStore(
    subscribeConversationAnchorState,
    () => getConversationActiveAnchor(conversationId),
    () => null
  )

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
      }),
    [locale]
  )

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeStyle: "short",
      }),
    [locale]
  )

  const { userMessages, userMessageGroups } = useMemo(() => {
    const todaySerial = getLocalDaySerial(new Date())
    const timelineTurns = getTimelineTurns(conversationId).map(
      (item) => item.turn
    )
    const chronologicalMessages: UserMessageListItem[] = []
    const chronologicalGroups: UserMessageSequenceGroup[] = []
    let pendingGroup: UserMessageListItem[] = []

    const createUserMessageItem = (
      turn: MessageTurn,
      sequence: number
    ): UserMessageListItem => {
      const previewText = buildConversationUserMessagePreview(turn.blocks)
      const imageCount = countConversationUserMessageImages(turn.blocks)
      const preview =
        previewText ??
        (imageCount > 0
          ? t("imageAttachmentCount", { count: imageCount })
          : t("fallbackLabel"))

      const timestampDate = new Date(turn.timestamp)
      if (Number.isNaN(timestampDate.getTime())) {
        return {
          anchorId: turn.anchor_id as string,
          preview,
          timestamp: turn.timestamp,
          sequence,
          dateGroupKey: turn.timestamp,
          dateGroupLabel: turn.timestamp,
          timeLabel: turn.timestamp,
          dateTimeLabel: turn.timestamp,
        }
      }

      const daySerial = getLocalDaySerial(timestampDate)
      const dayDiff = todaySerial - daySerial
      const dateGroupLabel =
        dayDiff === 0
          ? t("dateGroupToday")
          : dayDiff === 1
            ? t("dateGroupYesterday")
            : dateFormatter.format(timestampDate)
      const timeLabel = timeFormatter.format(timestampDate)

      return {
        anchorId: turn.anchor_id as string,
        preview,
        timestamp: turn.timestamp,
        sequence,
        dateGroupKey: getLocalDateGroupKey(timestampDate),
        dateGroupLabel,
        timeLabel,
        dateTimeLabel: `${dateGroupLabel} · ${timeLabel}`,
      }
    }

    const flushPendingGroup = () => {
      if (pendingGroup.length === 0) {
        return
      }

      const messages = [...pendingGroup].reverse()
      const summary = messages[0]

      chronologicalGroups.push({
        key: summary.anchorId,
        summary,
        messages,
        dateGroupKey: summary.dateGroupKey,
        dateGroupLabel: summary.dateGroupLabel,
      })
      pendingGroup = []
    }

    let sequence = 0

    for (const turn of timelineTurns) {
      if (turn.role === "assistant") {
        flushPendingGroup()
        continue
      }

      if (turn.role !== "user" || !turn.anchor_id) {
        continue
      }

      sequence += 1
      const message = createUserMessageItem(turn, sequence)
      chronologicalMessages.push(message)
      pendingGroup.push(message)
    }

    flushPendingGroup()

    return {
      userMessages: chronologicalMessages.reverse(),
      userMessageGroups: chronologicalGroups.reverse(),
    }
  }, [conversationId, dateFormatter, getTimelineTurns, t, timeFormatter])

  const visibleCount =
    visibleState.conversationId === conversationId
      ? visibleState.count
      : INITIAL_VISIBLE_USER_MESSAGES

  const { visibleUserMessageGroups, visibleMessageCount } = useMemo(() => {
    const nextVisibleGroups: UserMessageSequenceGroup[] = []
    let nextVisibleMessageCount = 0

    for (const group of userMessageGroups) {
      if (
        nextVisibleGroups.length > 0 &&
        nextVisibleMessageCount >= visibleCount
      ) {
        break
      }

      nextVisibleGroups.push(group)
      nextVisibleMessageCount += group.messages.length
    }

    return {
      visibleUserMessageGroups: nextVisibleGroups,
      visibleMessageCount: nextVisibleMessageCount,
    }
  }, [userMessageGroups, visibleCount])

  const visibleDateGroups = useMemo<UserMessageDateGroup[]>(() => {
    return visibleUserMessageGroups.reduce<UserMessageDateGroup[]>(
      (groups, group) => {
        const lastGroup = groups[groups.length - 1]
        if (lastGroup && lastGroup.key === group.dateGroupKey) {
          lastGroup.groups.push(group)
          return groups
        }

        groups.push({
          key: group.dateGroupKey,
          label: group.dateGroupLabel,
          groups: [group],
        })
        return groups
      },
      []
    )
  }, [visibleUserMessageGroups])

  const visibleAnchorIds = useMemo(() => {
    const anchorIds = new Set<string>()

    for (const group of visibleUserMessageGroups) {
      for (const message of group.messages) {
        anchorIds.add(message.anchorId)
      }
    }

    return anchorIds
  }, [visibleUserMessageGroups])

  const activeMessage = useMemo(
    () =>
      activeAnchorId
        ? (userMessages.find(
            (message) => message.anchorId === activeAnchorId
          ) ?? null)
        : null,
    [activeAnchorId, userMessages]
  )

  const hiddenActiveMessage =
    activeMessage && !visibleAnchorIds.has(activeMessage.anchorId)
      ? activeMessage
      : null

  const handleListScroll = useCallback((event: Event) => {
    const target = event.target as HTMLElement
    const shouldShow =
      target.scrollTop > USER_MESSAGES_SCROLL_TO_TOP_THRESHOLD_PX

    setShowScrollToTop((current) =>
      current === shouldShow ? current : shouldShow
    )
  }, [])

  const handleScrollToTop = useCallback(() => {
    const viewport = scrollViewportRef.current
      ?.osInstance()
      ?.elements().viewport
    if (!viewport) {
      return
    }

    viewport.scrollTo({
      top: 0,
      behavior: "smooth",
    })
    setShowScrollToTop(false)
  }, [])

  useEffect(() => {
    if (!activeAnchorId || !visibleAnchorIds.has(activeAnchorId)) {
      return
    }

    const viewport = scrollViewportRef.current
      ?.osInstance()
      ?.elements().viewport
    const targetNode = messageNodeRefs.current.get(activeAnchorId)

    if (!viewport || !targetNode) {
      return
    }

    const viewportRect = viewport.getBoundingClientRect()
    const targetRect = targetNode.getBoundingClientRect()
    const topBoundary = viewportRect.top + VIEWPORT_VISIBILITY_EPSILON_PX
    const bottomBoundary = viewportRect.bottom - VIEWPORT_VISIBILITY_EPSILON_PX
    const isAboveViewport = targetRect.top < topBoundary
    const isBelowViewport = targetRect.bottom > bottomBoundary

    if (!isAboveViewport && !isBelowViewport) {
      return
    }

    targetNode.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    })
  }, [activeAnchorId, visibleAnchorIds])

  const remainingCount = Math.max(userMessages.length - visibleMessageCount, 0)

  const handleSelectAnchor = (anchorId: string) => {
    emitConversationAnchorScrollRequest({
      conversationId,
      anchorId,
    })
    activateConversationPane()
    if (isMobile && isOpen) {
      toggle()
    }
  }

  if (loading && userMessages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <p className="text-xs text-muted-foreground text-center">
          {t("loading")}
        </p>
      </div>
    )
  }

  if (userMessages.length === 0) {
    return (
      <UserMessagesEmptyState title={t("emptyTitle")} hint={t("emptyHint")} />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border bg-sidebar/95 px-3 py-3 supports-[backdrop-filter]:bg-sidebar/85 supports-[backdrop-filter]:backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
              {t("countLabel", { count: userMessages.length })}
            </span>
          </div>
          <span className="shrink-0 text-right text-[11px] leading-4 text-muted-foreground">
            {t("showingLabel", {
              visible: visibleMessageCount,
              total: userMessages.length,
            })}
          </span>
        </div>

        {hiddenActiveMessage ? (
          <button
            type="button"
            className="mt-3 flex w-full items-start gap-3 rounded-xl border border-primary/35 bg-primary/10 px-3 py-2.5 text-left shadow-sm ring-1 ring-primary/10 transition-colors hover:bg-primary/14"
            onClick={() => handleSelectAnchor(hiddenActiveMessage.anchorId)}
          >
            <span
              className="mt-0.5 block h-10 w-1.5 shrink-0 rounded-full bg-primary"
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {t("activeBadge")}
                </span>
                <span className="text-xs font-medium text-primary">
                  {hiddenActiveMessage.dateTimeLabel}
                </span>
              </div>
              <p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">
                {hiddenActiveMessage.preview}
              </p>
            </div>
            <span className="shrink-0 rounded-md border border-primary/20 bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-primary">
              #{hiddenActiveMessage.sequence}
            </span>
          </button>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1">
        <ScrollArea
          ref={scrollViewportRef}
          onScroll={handleListScroll}
          className="min-h-0 h-full px-2 py-3"
        >
          <div className="space-y-3">
            {visibleDateGroups.map((dateGroup) => (
              <section key={dateGroup.key} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {dateGroup.label}
                  </span>
                  <div className="h-px flex-1 bg-border/70" aria-hidden />
                </div>

                <div className="space-y-2">
                  {dateGroup.groups.map((messageGroup) => {
                    const isMultiMessageGroup = messageGroup.messages.length > 1
                    const isActiveGroup = messageGroup.messages.some(
                      (message) => message.anchorId === activeAnchorId
                    )

                    if (!isMultiMessageGroup) {
                      const message = messageGroup.messages[0]
                      const isActive = message.anchorId === activeAnchorId

                      return (
                        <Button
                          key={`${message.anchorId}-${message.sequence}`}
                          ref={registerMessageNode(message.anchorId)}
                          type="button"
                          variant="ghost"
                          aria-pressed={isActive}
                          className={cn(
                            "group h-auto w-full items-start justify-start rounded-xl border px-3 py-3 text-left shadow-none transition-all",
                            isActive
                              ? "border-primary/40 bg-primary/12 text-foreground shadow-sm ring-1 ring-primary/10 hover:bg-primary/14 dark:bg-primary/18"
                              : "border-border bg-card hover:bg-accent/40"
                          )}
                          onClick={() => handleSelectAnchor(message.anchorId)}
                        >
                          <div className="flex w-full items-start gap-3">
                            <span
                              className={cn(
                                "mt-0.5 block h-10 w-1 shrink-0 rounded-full transition-colors",
                                isActive
                                  ? "bg-primary"
                                  : "bg-border/80 group-hover:bg-border"
                              )}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <p
                                  className={cn(
                                    "min-w-0 truncate text-xs",
                                    isActive
                                      ? "font-medium text-primary"
                                      : "text-muted-foreground"
                                  )}
                                >
                                  {message.timeLabel}
                                </p>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {isActive ? (
                                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                      {t("activeBadge")}
                                    </span>
                                  ) : null}
                                  <span
                                    className={cn(
                                      "rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums",
                                      isActive
                                        ? "border-primary/20 bg-background/80 text-primary"
                                        : "border-border bg-muted/40 text-muted-foreground"
                                    )}
                                  >
                                    #{message.sequence}
                                  </span>
                                </div>
                              </div>
                              <p
                                className={cn(
                                  "line-clamp-2 text-sm leading-5 text-foreground",
                                  isActive && "font-medium"
                                )}
                              >
                                {message.preview}
                              </p>
                            </div>
                          </div>
                        </Button>
                      )
                    }

                    return (
                      <div
                        key={messageGroup.key}
                        className={cn(
                          "overflow-hidden rounded-xl border bg-card transition-all",
                          isActiveGroup
                            ? "border-primary/40 bg-primary/10 shadow-sm ring-1 ring-primary/10"
                            : "border-border"
                        )}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          className={cn(
                            "h-auto w-full justify-start rounded-none border-0 px-3 py-3 text-left shadow-none",
                            isActiveGroup
                              ? "bg-transparent hover:bg-primary/8"
                              : "bg-transparent hover:bg-accent/40"
                          )}
                          onClick={() =>
                            handleSelectAnchor(messageGroup.summary.anchorId)
                          }
                        >
                          <div className="flex w-full items-start gap-3">
                            <span
                              className={cn(
                                "mt-0.5 block h-10 w-1.5 shrink-0 rounded-full transition-colors",
                                isActiveGroup ? "bg-primary" : "bg-border/80"
                              )}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <p
                                    className={cn(
                                      "min-w-0 truncate text-xs",
                                      isActiveGroup
                                        ? "font-medium text-primary"
                                        : "text-muted-foreground"
                                    )}
                                  >
                                    {messageGroup.summary.timeLabel}
                                  </p>
                                  <p
                                    className={cn(
                                      "line-clamp-2 text-sm leading-5 text-foreground",
                                      isActiveGroup && "font-medium"
                                    )}
                                  >
                                    {messageGroup.summary.preview}
                                  </p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                  {isActiveGroup ? (
                                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                      {t("activeBadge")}
                                    </span>
                                  ) : null}
                                  <span
                                    className={cn(
                                      "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                      isActiveGroup
                                        ? "border-primary/20 bg-background/80 text-primary"
                                        : "border-border bg-muted/40 text-muted-foreground"
                                    )}
                                  >
                                    {t("groupCountLabel", {
                                      count: messageGroup.messages.length,
                                    })}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </Button>

                        <div className="border-t border-border/70 px-2 py-2">
                          <div className="space-y-1.5">
                            {messageGroup.messages.map((message) => {
                              const isActive =
                                message.anchorId === activeAnchorId
                              const messageTimeLabel =
                                message.dateGroupKey ===
                                messageGroup.dateGroupKey
                                  ? message.timeLabel
                                  : message.dateTimeLabel

                              return (
                                <Button
                                  key={`${messageGroup.key}-${message.anchorId}-${message.sequence}`}
                                  ref={registerMessageNode(message.anchorId)}
                                  type="button"
                                  variant="ghost"
                                  aria-pressed={isActive}
                                  className={cn(
                                    "group h-auto w-full items-start justify-start rounded-lg border px-2.5 py-2 text-left shadow-none transition-colors",
                                    isActive
                                      ? "border-primary/30 bg-primary/10 text-foreground hover:bg-primary/12"
                                      : "border-transparent hover:bg-accent/40"
                                  )}
                                  onClick={() =>
                                    handleSelectAnchor(message.anchorId)
                                  }
                                >
                                  <div className="flex w-full items-start gap-3">
                                    <span
                                      className={cn(
                                        "mt-1 block h-2.5 w-2.5 shrink-0 rounded-full border transition-colors",
                                        isActive
                                          ? "border-primary bg-primary"
                                          : "border-border bg-background"
                                      )}
                                      aria-hidden
                                    />
                                    <div className="min-w-0 flex-1 space-y-1">
                                      <div className="flex items-start justify-between gap-2">
                                        <p
                                          className={cn(
                                            "min-w-0 truncate text-xs",
                                            isActive
                                              ? "font-medium text-primary"
                                              : "text-muted-foreground"
                                          )}
                                        >
                                          {messageTimeLabel}
                                        </p>
                                        <div className="flex shrink-0 items-center gap-1.5">
                                          {isActive ? (
                                            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                              {t("activeBadge")}
                                            </span>
                                          ) : null}
                                          <span
                                            className={cn(
                                              "rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums",
                                              isActive
                                                ? "border-primary/20 bg-background/80 text-primary"
                                                : "border-border bg-muted/40 text-muted-foreground"
                                            )}
                                          >
                                            #{message.sequence}
                                          </span>
                                        </div>
                                      </div>
                                      <p
                                        className={cn(
                                          "line-clamp-1 text-xs leading-5 text-foreground/90",
                                          isActive &&
                                            "font-medium text-foreground"
                                        )}
                                      >
                                        {message.preview}
                                      </p>
                                    </div>
                                  </div>
                                </Button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}

            {remainingCount > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl"
                onClick={() =>
                  setVisibleState((current) => {
                    const baseCount =
                      current.conversationId === conversationId
                        ? current.count
                        : INITIAL_VISIBLE_USER_MESSAGES

                    return {
                      conversationId,
                      count: Math.min(
                        userMessages.length,
                        baseCount + LOAD_MORE_USER_MESSAGES_STEP
                      ),
                    }
                  })
                }
              >
                <ChevronDown className="size-4" />
                {t("showMore", {
                  count: Math.min(remainingCount, LOAD_MORE_USER_MESSAGES_STEP),
                })}
              </Button>
            ) : null}
          </div>
        </ScrollArea>

        {showScrollToTop ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute right-4 bottom-4 z-10 rounded-full bg-background/90 shadow-sm hover:bg-muted/90"
            onClick={handleScrollToTop}
            title={threadT("scrollToTop")}
          >
            <ArrowUpIcon className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function UserMessagesTab() {
  const t = useTranslations("Folder.auxPanel.userMessages")
  const { tabs, activeTabId } = useTabContext()
  const { getTimelineTurns } = useConversationRuntime()

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const runtimeConversationId = activeTab?.runtimeConversationId ?? null
  const persistedConversationId = activeTab?.conversationId ?? null
  const conversationId = runtimeConversationId ?? persistedConversationId
  const hasDraftUserMessages =
    runtimeConversationId != null &&
    persistedConversationId == null &&
    getTimelineTurns(runtimeConversationId).some(
      (item) => item.turn.role === "user"
    )

  if (!activeTab) {
    return (
      <UserMessagesEmptyState
        title={t("noConversationTitle")}
        hint={t("noConversationHint")}
      />
    )
  }

  if (
    !conversationId ||
    (persistedConversationId == null && !hasDraftUserMessages)
  ) {
    return (
      <UserMessagesEmptyState
        title={t("draftConversationTitle")}
        hint={t("draftConversationHint")}
      />
    )
  }

  return <UserMessagesTabContent conversationId={conversationId} />
}
