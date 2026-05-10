"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import { type VirtualizerHandle } from "virtua"
import { useConversationRuntime } from "@/contexts/conversation-runtime-context"
import { ContentPartsRenderer } from "./content-parts-renderer"
import {
  createMessageTurnAdapter,
  mergeAdjacentToolGroups,
  type AdaptedContentPart,
  type AdaptedMessage,
  type MessageTurnAdapter,
  type UserImageDisplay,
  type UserResourceDisplay,
} from "@/lib/adapters/ai-elements-adapter"
import { TurnStats } from "./turn-stats"
import { LiveTurnStats } from "./live-turn-stats"
import { UserResourceLinks } from "./user-resource-links"
import { UserImageAttachments } from "./user-image-attachments"
import { useSessionStats } from "@/contexts/session-stats-context"
import { AgentPlanOverlay } from "@/components/chat/agent-plan-overlay"
import {
  MessageThread,
  MessageThreadScrollButton,
} from "@/components/ai-elements/message-thread"
import {
  Message,
  MessageContent,
  MessageAction,
} from "@/components/ai-elements/message"
import {
  AlertCircle,
  CheckIcon,
  ChevronDown,
  ChevronRight,
  CopyIcon,
  Info,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"
import {
  buildPlanKey,
  extractLatestPlanEntriesFromMessages,
} from "@/lib/agent-plan"
import {
  addConversationAnchorScrollRequestListener,
  clearLatestConversationAnchorScrollRequest,
  getLatestConversationAnchorScrollRequest,
  loadConversationUserAnchor,
  saveConversationUserAnchor,
  setConversationActiveAnchor,
} from "@/lib/conversation-anchor-storage"
import type { AgentType, ConnectionStatus, SessionStats } from "@/lib/types"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import { cn, copyTextToClipboard } from "@/lib/utils"
import { VirtualizedMessageThread } from "@/components/message/virtualized-message-thread"
import {
  type StickToBottomContext,
  useStickToBottomContext,
} from "use-stick-to-bottom"

interface MessageListViewProps {
  conversationId: number
  anchorStorageConversationId?: number
  agentType: AgentType
  connStatus?: ConnectionStatus | null
  showPromptingState?: boolean
  isActive?: boolean
  sendSignal?: number
  sessionStats?: SessionStats | null
  detailLoading?: boolean
  detailError?: string | null
  /**
   * Set when the agent rejected `session/load` non-recoverably (e.g. the
   * historical session_id was deleted). Takes precedence over `detailError`
   * AND the renderable-content gate: even when the local DB has the full
   * message history, the user must explicitly choose Reload or start a new
   * conversation since the agent can't continue this thread.
   */
  acpLoadError?: string | null
  hideEmptyState?: boolean
  onReload?: () => void
  onNewSession?: () => void
}

interface UserAnchorItem {
  anchorId: string
  itemKey: string
  rowIndex: number
}

interface ProgrammaticAnchorScrollLock {
  targetAnchorId: string | null
  requestId: string | null
}

const RESTORE_SCROLL_PASSES = 12
const RESTORE_BOTTOM_SETTLED_FRAMES = 2
const PROGRAMMATIC_SCROLL_LOCK_TIMEOUT_MS = 900
const LIVE_TAIL_FOLLOW_THRESHOLD_PX = 96

interface ResolvedMessageGroup {
  id: string
  role: "user" | "assistant" | "system"
  parts: AdaptedContentPart[]
  resources: UserResourceDisplay[]
  images: UserImageDisplay[]
  usage?: import("@/lib/types").TurnUsage | null
  duration_ms?: number | null
  model?: string | null
  models?: string[]
  /**
   * Wall-clock completion time supplied by the Rust parser. For merged
   * sub-turns this reflects the last sub-turn's completion (inherited
   * automatically via `{ ...last.group }`), not first-start + accumulated
   * duration.
   */
  completed_at?: string | null
}

type ThreadRenderItem =
  | {
      key: string
      kind: "turn"
      group: ResolvedMessageGroup
      phase: "persisted" | "optimistic" | "streaming"
      anchorId: string | null
      showStats: boolean
      isRoleTransition: boolean
      previousUserIndex: number | null
    }
  | {
      key: string
      kind: "typing"
    }

function isOptimisticAnchorId(anchorId: string | null | undefined): boolean {
  return typeof anchorId === "string" && anchorId.startsWith("optimistic:")
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

function isRowNearViewportCenter(
  row: HTMLDivElement,
  viewport: HTMLElement
): boolean {
  const rowRect = row.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  const viewportCenter = viewportRect.top + viewportRect.height / 2
  const rowCenter = rowRect.top + rowRect.height / 2
  const distance = Math.abs(rowCenter - viewportCenter)
  const tolerance = Math.max(24, Math.min(viewportRect.height * 0.2, 160))

  return distance <= tolerance
}

function isVirtualRowNearViewportCenter(
  anchor: UserAnchorItem,
  virtualizer: VirtualizerHandle,
  viewport: HTMLElement
): boolean {
  const rowOffset = virtualizer.getItemOffset(anchor.rowIndex)
  const rowSize = virtualizer.getItemSize(anchor.rowIndex)
  if (
    !Number.isFinite(rowOffset) ||
    !Number.isFinite(rowSize) ||
    rowSize <= 0
  ) {
    return false
  }

  const viewportCenter = viewport.scrollTop + viewport.clientHeight / 2
  const rowCenter = rowOffset + rowSize / 2
  const distance = Math.abs(rowCenter - viewportCenter)
  const tolerance = Math.max(24, Math.min(viewport.clientHeight * 0.2, 160))

  return distance <= tolerance
}

function scrollMountedRowToCenter(
  row: HTMLDivElement,
  viewport: HTMLElement,
  smooth: boolean
): void {
  const rowRect = row.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  const targetScrollTop = Math.max(
    0,
    viewport.scrollTop +
      (rowRect.top - viewportRect.top) -
      (viewport.clientHeight - rowRect.height) / 2
  )

  viewport.scrollTo({
    top: targetScrollTop,
    behavior: smooth ? "smooth" : "auto",
  })
}

function forceScrollAnchorToCenter(
  anchor: UserAnchorItem,
  virtualizer: VirtualizerHandle,
  viewport: HTMLElement,
  stickToBottom: StickToBottomContext
): void {
  virtualizer.scrollToIndex(anchor.rowIndex, {
    align: "center",
    smooth: false,
  })

  const rowOffset = virtualizer.getItemOffset(anchor.rowIndex)
  const rowSize = virtualizer.getItemSize(anchor.rowIndex)
  if (
    !Number.isFinite(rowOffset) ||
    !Number.isFinite(rowSize) ||
    rowSize <= 0
  ) {
    return
  }

  const targetScrollTop = Math.max(
    0,
    rowOffset - (viewport.clientHeight - rowSize) / 2
  )

  stickToBottom.stopScroll()
  viewport.scrollTop = targetScrollTop
}

const CollapsibleSystemMessage = memo(function CollapsibleSystemMessage({
  group,
}: {
  group: ResolvedMessageGroup
}) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslations("Folder.chat.messageList")

  return (
    <div className="border rounded-md text-sm border-yellow-500/30 bg-yellow-500/5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-yellow-500/10 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-500" />
        )}
        <Info className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-500" />
        <span className="font-medium text-yellow-700 dark:text-yellow-400">
          {t("systemMessage")}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-yellow-500/20">
          <div className="text-sm text-muted-foreground mt-2.5 max-h-96 overflow-auto">
            <ContentPartsRenderer parts={group.parts} role={group.role} />
          </div>
        </div>
      )}
    </div>
  )
})

function extractTextFromParts(parts: AdaptedContentPart[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

type AssistantTurnItem = Extract<ThreadRenderItem, { kind: "turn" }>

function isEmptyTurnItem(item: ThreadRenderItem): boolean {
  if (item.kind !== "turn") return false
  const g = item.group
  if (g.parts.length > 0) return false
  if (g.resources.length > 0) return false
  if (g.images.length > 0) return false
  return true
}

/**
 * Collapse runs of consecutive assistant turn render items into a single
 * synthetic turn so tool-groups straddling a turn boundary fold into one
 * collapsible. Empty (no-content) turn items are treated as transparent and
 * do not break the run — that handles cases where parsers leave empty
 * placeholder turns between tool exchanges.
 */
function mergeConsecutiveAssistantTurns(
  items: ThreadRenderItem[]
): ThreadRenderItem[] {
  const result: ThreadRenderItem[] = []
  const skipped: ThreadRenderItem[] = []
  let buffer: AssistantTurnItem[] = []

  const flush = () => {
    if (buffer.length === 0) {
      // Drain any skipped (empty) items collected since last flush
      for (const s of skipped) result.push(s)
      skipped.length = 0
      return
    }

    if (buffer.length === 1) {
      result.push(buffer[0])
    } else {
      const allParts = buffer.flatMap((it) => it.group.parts)
      const mergedParts = mergeAdjacentToolGroups(allParts)
      const last = buffer[buffer.length - 1]
      const first = buffer[0]

      // Aggregate stats across the merged sub-turns so the post-stream
      // stats row reflects the whole assistant response, not just the
      // last sub-turn. Without this, multi-turn agents (Task tool, codex
      // agent loops, etc.) would visibly under-report tokens.
      let mergedUsage: import("@/lib/types").TurnUsage | null = null
      let mergedDuration: number | null = null
      const seenModels = new Set<string>()
      const mergedModels: string[] = []
      for (const it of buffer) {
        const u = it.group.usage
        if (u) {
          if (!mergedUsage) {
            mergedUsage = {
              input_tokens: u.input_tokens,
              output_tokens: u.output_tokens,
              cache_creation_input_tokens: u.cache_creation_input_tokens,
              cache_read_input_tokens: u.cache_read_input_tokens,
            }
          } else {
            mergedUsage.input_tokens += u.input_tokens
            mergedUsage.output_tokens += u.output_tokens
            mergedUsage.cache_creation_input_tokens +=
              u.cache_creation_input_tokens
            mergedUsage.cache_read_input_tokens += u.cache_read_input_tokens
          }
        }
        if (typeof it.group.duration_ms === "number") {
          mergedDuration = (mergedDuration ?? 0) + it.group.duration_ms
        }
        if (it.group.model && !seenModels.has(it.group.model)) {
          seenModels.add(it.group.model)
          mergedModels.push(it.group.model)
        }
      }

      result.push({
        ...last,
        key: `merged-${first.key}`,
        group: {
          ...last.group,
          id: first.group.id,
          parts: mergedParts,
          usage: mergedUsage,
          duration_ms: mergedDuration,
          model: mergedModels[0] ?? last.group.model,
          models: mergedModels.length > 1 ? mergedModels : undefined,
        },
      })
    }

    // Drop any empty items that were collapsed inside the run
    skipped.length = 0
    buffer = []
  }

  for (const item of items) {
    if (item.kind === "turn" && item.group.role === "assistant") {
      // Flush any leading skipped (empty non-assistant) items before starting
      // a fresh assistant run. This keeps non-assistant placeholders in their
      // original relative order when no merging happens.
      if (buffer.length === 0) {
        for (const s of skipped) result.push(s)
        skipped.length = 0
      }
      buffer.push(item)
      continue
    }

    if (buffer.length > 0 && isEmptyTurnItem(item)) {
      // Transparent: don't break the run, but track in case we end up not
      // merging (single-buffer case still drops them as they're invisible).
      skipped.push(item)
      continue
    }

    flush()
    result.push(item)
  }
  flush()

  return result
}

const UserMessageCopyButton = memo(function UserMessageCopyButton({
  parts,
}: {
  parts: AdaptedContentPart[]
}) {
  const t = useTranslations("Folder.chat.messageList")
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number>(0)

  const handleCopy = useCallback(async () => {
    if (isCopied) return
    const text = extractTextFromParts(parts)
    if (!text) return
    const ok = await copyTextToClipboard(text)
    if (!ok) return
    setIsCopied(true)
    timeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000)
  }, [parts, isCopied])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    []
  )

  return (
    <MessageAction
      tooltip={isCopied ? t("copied") : t("copyMessage")}
      className="opacity-0 group-hover/user-msg:opacity-100 transition-opacity self-end"
      onClick={handleCopy}
      size="icon-xs"
    >
      {isCopied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </MessageAction>
  )
})

const HistoricalMessageGroup = memo(function HistoricalMessageGroup({
  group,
  dimmed = false,
  showStats = true,
  previousUserIndex = null,
  isResponseComplete = true,
}: {
  group: ResolvedMessageGroup
  dimmed?: boolean
  showStats?: boolean
  previousUserIndex?: number | null
  isResponseComplete?: boolean
}) {
  if (group.role === "system") {
    return <CollapsibleSystemMessage group={group} />
  }

  return (
    <div className={cn(dimmed && "opacity-70")}>
      <Message from={group.role}>
        {group.role === "user" && group.images.length > 0 ? (
          <UserImageAttachments images={group.images} className="self-end" />
        ) : null}
        {group.role === "user" ? (
          <div className="group/user-msg flex w-fit ml-auto max-w-full items-start gap-1">
            <UserMessageCopyButton parts={group.parts} />
            <MessageContent>
              <ContentPartsRenderer parts={group.parts} role={group.role} />
            </MessageContent>
          </div>
        ) : (
          <MessageContent>
            <ContentPartsRenderer parts={group.parts} role={group.role} />
          </MessageContent>
        )}
        {group.role === "user" && group.resources.length > 0 ? (
          <UserResourceLinks resources={group.resources} className="self-end" />
        ) : null}
      </Message>
      {showStats && group.role === "assistant" && (
        <TurnStats
          usage={group.usage}
          duration_ms={group.duration_ms}
          model={group.model}
          models={group.models}
          previousUserIndex={previousUserIndex}
          isResponseComplete={isResponseComplete}
          copyText={extractTextFromParts(group.parts)}
          completedAt={group.completed_at}
        />
      )}
    </div>
  )
})

const PendingTypingIndicator = memo(function PendingTypingIndicator() {
  return (
    <Message from="assistant">
      <MessageContent>
        <div className="flex items-center gap-1.5 py-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_infinite]" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_0.4s_infinite]" />
        </div>
      </MessageContent>
    </Message>
  )
})

const AutoScrollOnSend = memo(function AutoScrollOnSend({
  signal,
}: {
  signal: number
}) {
  const { scrollToBottom } = useStickToBottomContext()
  const lastSignalRef = useRef(signal)

  useEffect(() => {
    if (signal === lastSignalRef.current) return
    lastSignalRef.current = signal

    scrollToBottom()
    const rafId = requestAnimationFrame(() => {
      scrollToBottom()
    })
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [scrollToBottom, signal])

  return null
})

function buildLiveTailSignature(liveMessage: LiveMessage | null): string {
  if (!liveMessage) return "none"

  return liveMessage.content
    .map((block) => {
      switch (block.type) {
        case "text":
        case "thinking":
          return `${block.type}:${block.text.length}`
        case "plan":
          return `plan:${block.entries
            .map(
              (entry) =>
                `${entry.status}:${entry.priority}:${entry.content.length}`
            )
            .join(",")}`
        case "tool_call": {
          const info = block.info
          return [
            "tool",
            info.tool_call_id,
            info.title,
            info.kind,
            info.status,
            info.content?.length ?? 0,
            info.raw_input?.length ?? 0,
            info.raw_output_chunks.length,
            info.raw_output_total_bytes,
            info.images
              .map(
                (image) =>
                  `${image.mime_type}:${image.uri ?? ""}:${image.data.length}`
              )
              .join(","),
          ].join(":")
        }
        default:
          return "unknown"
      }
    })
    .join("|")
}

function buildContentPartSignature(part: AdaptedContentPart): string {
  switch (part.type) {
    case "text":
      return `text:${part.text.length}`
    case "reasoning":
      return `reasoning:${part.isStreaming}:${part.content.length}`
    case "tool-call":
      return [
        "tool-call",
        part.toolCallId,
        part.toolName,
        part.displayTitle ?? "",
        part.state,
        part.input?.length ?? 0,
        part.output?.length ?? 0,
        part.errorText?.length ?? 0,
      ].join(":")
    case "tool-result":
      return [
        "tool-result",
        part.toolCallId,
        part.state,
        part.output?.length ?? 0,
        part.errorText?.length ?? 0,
      ].join(":")
    case "tool-group":
      return `tool-group:${part.isStreaming}:${part.items
        .map(buildContentPartSignature)
        .join(",")}`
    case "generated-image":
      return [
        "generated-image",
        part.status ?? "unknown",
        part.revisedPrompt?.length ?? 0,
        part.image?.mime_type ?? "",
        part.image?.uri ?? "",
        part.image?.data.length ?? 0,
      ].join(":")
  }
}

function buildThreadTailSignature(items: ThreadRenderItem[]): string {
  const tail = items[items.length - 1]
  if (!tail) return "empty"
  if (tail.kind === "typing") return `${items.length}:typing`

  return [
    items.length,
    tail.key,
    tail.phase,
    tail.group.role,
    tail.group.parts.length,
    tail.group.parts.map(buildContentPartSignature).join(","),
  ].join("|")
}

const AutoScrollOnLiveTail = memo(function AutoScrollOnLiveTail({
  isStreaming,
  tailSignature,
}: {
  isStreaming: boolean
  tailSignature: string
}) {
  const { isAtBottom, scrollRef, scrollToBottom, state } =
    useStickToBottomContext()
  const lastSignatureRef = useRef(tailSignature)
  const wasStreamingRef = useRef(isStreaming)
  const shouldFollowTailRef = useRef(isAtBottom)
  const frameRef = useRef<number | null>(null)
  const stateAtBottom = state.isAtBottom
  const escapedFromLock = state.escapedFromLock

  const scheduleFollowTail = useCallback(() => {
    if (!shouldFollowTailRef.current || frameRef.current !== null) {
      return
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      if (!shouldFollowTailRef.current) return
      scrollToBottom({ animation: "instant" })
    })
  }, [scrollToBottom])

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport) {
      shouldFollowTailRef.current = isAtBottom
      return
    }

    const updateFollowIntent = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      const nearBottom = distanceFromBottom <= LIVE_TAIL_FOLLOW_THRESHOLD_PX
      const shouldFollow = nearBottom || (stateAtBottom && !escapedFromLock)
      const becameFollowed = shouldFollow && !shouldFollowTailRef.current

      shouldFollowTailRef.current = shouldFollow
      if (becameFollowed) {
        scheduleFollowTail()
      }
    }

    updateFollowIntent()
    viewport.addEventListener("scroll", updateFollowIntent, { passive: true })

    return () => {
      viewport.removeEventListener("scroll", updateFollowIntent)
    }
  }, [
    escapedFromLock,
    isAtBottom,
    scheduleFollowTail,
    scrollRef,
    stateAtBottom,
  ])

  useEffect(() => {
    if (tailSignature === lastSignatureRef.current) {
      return
    }

    lastSignatureRef.current = tailSignature
    const justFinishedStreaming = wasStreamingRef.current && !isStreaming
    wasStreamingRef.current = isStreaming
    if (!shouldFollowTailRef.current || justFinishedStreaming) {
      return
    }

    scheduleFollowTail()
  }, [isStreaming, scheduleFollowTail, tailSignature])

  useEffect(() => {
    if (!isStreaming || typeof ResizeObserver === "undefined") {
      return
    }

    const viewport = scrollRef.current
    if (!viewport) return

    const observer = new ResizeObserver(() => {
      if (shouldFollowTailRef.current) {
        scheduleFollowTail()
      }
    })

    observer.observe(viewport)
    for (const child of Array.from(viewport.children)) {
      observer.observe(child)
    }

    return () => {
      observer.disconnect()
    }
  }, [isStreaming, scheduleFollowTail, scrollRef])

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    },
    []
  )

  return null
})

const ActiveUserAnchorTracker = memo(function ActiveUserAnchorTracker({
  detailLoading,
  userAnchors,
  virtualizerRef,
  persistAnchorSelection,
  onActiveAnchorChange,
  suspendPersistence,
  programmaticScrollLockRef,
}: {
  detailLoading: boolean
  userAnchors: UserAnchorItem[]
  virtualizerRef: RefObject<VirtualizerHandle | null>
  persistAnchorSelection: (anchorId: string | null) => void
  onActiveAnchorChange: (anchorId: string | null) => void
  suspendPersistence: boolean
  programmaticScrollLockRef: RefObject<ProgrammaticAnchorScrollLock>
}) {
  const { scrollRef } = useStickToBottomContext()

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport) {
      return
    }

    let frameId: number | null = null

    const computeActiveAnchor = () => {
      if (userAnchors.length === 0) {
        onActiveAnchorChange(null)
        if (!detailLoading && !suspendPersistence) {
          persistAnchorSelection(null)
        }
        return
      }

      const virtualizer = virtualizerRef.current
      if (!virtualizer) {
        return
      }

      const lockedAnchorId = programmaticScrollLockRef.current.targetAnchorId
      if (lockedAnchorId) {
        const lockedAnchor = userAnchors.find(
          (anchor) => anchor.anchorId === lockedAnchorId
        )
        if (lockedAnchor) {
          onActiveAnchorChange(lockedAnchorId)
          if (!suspendPersistence) {
            persistAnchorSelection(lockedAnchorId)
          }
          if (
            isVirtualRowNearViewportCenter(lockedAnchor, virtualizer, viewport)
          ) {
            return
          }
          return
        }
      }

      const viewportCenter = viewport.scrollTop + viewport.clientHeight / 2
      let closestAnchorId: string | null = null
      let closestDistance = Number.POSITIVE_INFINITY

      for (const anchor of userAnchors) {
        const rowOffset = virtualizer.getItemOffset(anchor.rowIndex)
        const rowSize = virtualizer.getItemSize(anchor.rowIndex)
        const rowCenter = rowOffset + rowSize / 2
        const distance = Math.abs(rowCenter - viewportCenter)
        if (distance < closestDistance) {
          closestDistance = distance
          closestAnchorId = anchor.anchorId
        }
      }

      onActiveAnchorChange(closestAnchorId)
      if (closestAnchorId && !suspendPersistence) {
        persistAnchorSelection(closestAnchorId)
      }
    }

    const scheduleActiveAnchorUpdate = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        computeActiveAnchor()
      })
    }

    scheduleActiveAnchorUpdate()
    viewport.addEventListener("scroll", scheduleActiveAnchorUpdate, {
      passive: true,
    })
    window.addEventListener("resize", scheduleActiveAnchorUpdate)
    return () => {
      viewport.removeEventListener("scroll", scheduleActiveAnchorUpdate)
      window.removeEventListener("resize", scheduleActiveAnchorUpdate)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [
    detailLoading,
    onActiveAnchorChange,
    persistAnchorSelection,
    programmaticScrollLockRef,
    scrollRef,
    suspendPersistence,
    userAnchors,
    virtualizerRef,
  ])

  return null
})

export function MessageListView({
  conversationId,
  anchorStorageConversationId,
  agentType,
  connStatus,
  showPromptingState = connStatus === "prompting",
  isActive = true,
  sendSignal = 0,
  sessionStats = null,
  detailLoading = false,
  detailError = null,
  acpLoadError = null,
  hideEmptyState = false,
  onReload,
  onNewSession,
}: MessageListViewProps) {
  const t = useTranslations("Folder.chat.messageList")
  const sharedT = useTranslations("Folder.chat.shared")
  const { getSession, getTimelineTurns } = useConversationRuntime()
  const session = getSession(conversationId)
  const liveMessage = session?.liveMessage ?? null
  const timelineTurns = getTimelineTurns(conversationId)
  const virtualizerRef = useRef<VirtualizerHandle | null>(null)
  const stickToBottomRef = useRef<StickToBottomContext | null>(null)
  const rowElementRefs = useRef(new Map<string, HTMLDivElement>())
  const restoreAttemptedRef = useRef(false)
  const pendingScrollAnchorIdRef = useRef<string | null>(null)
  const rafRestoreRef = useRef<number | null>(null)
  const programmaticScrollUnlockTimeoutRef = useRef<number | null>(null)
  const programmaticScrollLockRef = useRef<ProgrammaticAnchorScrollLock>({
    targetAnchorId: null,
    requestId: null,
  })
  const lastPersistedAnchorIdRef = useRef<string | null>(null)
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null)
  const [anchorRestoreState, setAnchorRestoreState] = useState<{
    conversationId: number | null
    pending: boolean
  }>({
    conversationId: null,
    pending: true,
  })

  const storageConversationId = anchorStorageConversationId ?? conversationId
  const suspendAnchorPersistence =
    anchorRestoreState.conversationId !== storageConversationId ||
    anchorRestoreState.pending

  const persistAnchorSelection = useCallback(
    (anchorId: string | null) => {
      if (isOptimisticAnchorId(anchorId)) {
        return
      }
      if (lastPersistedAnchorIdRef.current === anchorId) return
      lastPersistedAnchorIdRef.current = anchorId
      saveConversationUserAnchor(storageConversationId, anchorId)
    },
    [storageConversationId]
  )

  const { setSessionStats } = useSessionStats()

  useEffect(() => {
    if (isActive) {
      setSessionStats(sessionStats)
    }
  }, [isActive, sessionStats, setSessionStats])

  const shouldUseSmoothResize = !(
    isActive &&
    !detailLoading &&
    timelineTurns.length
  )

  const adapterText = useMemo(
    () => ({
      attachedResources: sharedT("attachedResources"),
      toolCallFailed: sharedT("toolCallFailed"),
    }),
    [sharedT]
  )

  const sessionSyncState = session?.syncState ?? "idle"

  // Per-instance turn adapter: caches per-turn `AdaptedMessage` so unchanged
  // historical turns survive every streaming-token re-render with stable refs.
  const [turnAdapter] = useState<MessageTurnAdapter>(() =>
    createMessageTurnAdapter()
  )

  // Sibling cache mapping each cached `AdaptedMessage` to its derived
  // `ResolvedMessageGroup`, so `HistoricalMessageGroup`'s `memo` can short-
  // circuit on prop reference equality.
  const [groupCache] = useState<WeakMap<AdaptedMessage, ResolvedMessageGroup>>(
    () => new WeakMap()
  )

  const { threadItems, nonStreamingAdapted, userAnchors } = useMemo(() => {
    const allTurns = timelineTurns.map((item) => item.turn)
    const streamingIndices = new Set<number>()
    const inProgressToolCallIdsByIndex = new Map<number, Set<string>>()
    timelineTurns.forEach((item, i) => {
      if (item.phase === "streaming") {
        streamingIndices.add(i)
        if (item.inProgressToolCallIds && item.inProgressToolCallIds.size > 0) {
          inProgressToolCallIdsByIndex.set(i, item.inProgressToolCallIds)
        }
      }
    })
    const allAdapted = turnAdapter.adapt(
      allTurns,
      adapterText,
      streamingIndices.size > 0 ? streamingIndices : undefined,
      inProgressToolCallIdsByIndex.size > 0
        ? inProgressToolCallIdsByIndex
        : undefined
    )

    // Collect non-streaming adapted messages for plan extraction
    const nonStreaming = allAdapted.filter(
      (_, index) => timelineTurns[index].phase !== "streaming"
    )

    // Map each adapted message directly to a render item (1:1).
    // Backend group_into_turns() already ensures each turn is a complete unit.
    const rawItems: ThreadRenderItem[] = allAdapted.map((msg, i) => {
      const phase = timelineTurns[i].phase
      const turn = timelineTurns[i].turn
      const role = msg.role === "tool" ? "assistant" : msg.role
      const key = `${phase}-${msg.id}-${i}`
      let group = groupCache.get(msg)
      if (!group) {
        group = {
          id: msg.id,
          role,
          parts: msg.content,
          resources: msg.userResources ?? [],
          images: msg.userImages ?? [],
          usage: msg.usage,
          duration_ms: msg.duration_ms,
          model: msg.model,
          completed_at: msg.completed_at,
        }
        groupCache.set(msg, group)
      }
      return {
        // Include phase so a turn that briefly coexists across phases (e.g.
        // a streaming turn that has just been promoted to localTurns while the
        // liveMessage is still attached) doesn't collide with itself in the
        // virtualized list. Index disambiguates further within a phase.
        key,
        kind: "turn" as const,
        group,
        phase,
        anchorId: role === "user" ? (turn.anchor_id ?? null) : null,
        showStats: false,
        isRoleTransition: false,
        previousUserIndex: null,
      }
    })

    // Collapse consecutive assistant turn render items into a single rendered
    // turn, so tool-groups straddling a turn boundary fold into one collapsible.
    const items = mergeConsecutiveAssistantTurns(rawItems)

    const anchors: UserAnchorItem[] = []
    items.forEach((item, rowIndex) => {
      if (
        item.kind === "turn" &&
        item.group.role === "user" &&
        item.anchorId !== null
      ) {
        anchors.push({
          anchorId: item.anchorId,
          itemKey: item.key,
          rowIndex,
        })
      }
    })

    // Compute showStats, isRoleTransition, and previousUserIndex for each turn.
    // previousUserIndex points at the closest preceding user turn (used by the
    // post-stream stats row's "jump to previous user message" button).
    let lastUserIdx: number | null = null
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]
      if (item.kind !== "turn") continue

      // isRoleTransition: role differs from previous turn item
      if (idx > 0) {
        const prev = items[idx - 1]
        if (prev.kind === "turn" && prev.group.role !== item.group.role) {
          item.isRoleTransition = true
        }
      }

      if (item.group.role === "user") {
        lastUserIdx = idx
      }

      // showStats: only on the last assistant turn before a non-assistant or end
      if (item.group.role === "assistant") {
        const next = items[idx + 1]
        if (!next || next.kind !== "turn" || next.group.role !== "assistant") {
          item.showStats = true
          item.previousUserIndex = lastUserIdx
        }
      }
    }

    const lastPhase = timelineTurns[timelineTurns.length - 1]?.phase ?? null
    if (
      lastPhase === "optimistic" &&
      (showPromptingState || sessionSyncState === "awaiting_persist")
    ) {
      items.push({ key: "pending-typing", kind: "typing" })
    }

    return {
      threadItems: items,
      nonStreamingAdapted: nonStreaming,
      userAnchors: anchors,
    }
  }, [
    adapterText,
    sessionSyncState,
    showPromptingState,
    timelineTurns,
    turnAdapter,
    groupCache,
  ])

  useEffect(
    () => () => {
      rowElementRefs.current.clear()
    },
    []
  )

  const historicalPlanEntries = useMemo(
    () => extractLatestPlanEntriesFromMessages(nonStreamingAdapted),
    [nonStreamingAdapted]
  )
  const historicalPlanKey = useMemo(
    () => buildPlanKey(historicalPlanEntries),
    [historicalPlanEntries]
  )
  const liveTailSignature = useMemo(
    () =>
      [
        showPromptingState ? "streaming" : "idle",
        buildLiveTailSignature(liveMessage),
        buildThreadTailSignature(threadItems),
      ].join("||"),
    [liveMessage, showPromptingState, threadItems]
  )
  const userAnchorMap = useMemo(
    () => new Map(userAnchors.map((anchor) => [anchor.anchorId, anchor])),
    [userAnchors]
  )

  const clearProgrammaticScrollLock = useCallback(() => {
    programmaticScrollLockRef.current.targetAnchorId = null
    programmaticScrollLockRef.current.requestId = null
    if (programmaticScrollUnlockTimeoutRef.current !== null) {
      window.clearTimeout(programmaticScrollUnlockTimeoutRef.current)
      programmaticScrollUnlockTimeoutRef.current = null
    }
  }, [])

  const armProgrammaticScrollLock = useCallback(
    (anchorId: string, requestId: string | null = null) => {
      programmaticScrollLockRef.current.targetAnchorId = anchorId
      programmaticScrollLockRef.current.requestId = requestId
      if (programmaticScrollUnlockTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollUnlockTimeoutRef.current)
      }
      programmaticScrollUnlockTimeoutRef.current = window.setTimeout(() => {
        programmaticScrollLockRef.current.targetAnchorId = null
        programmaticScrollLockRef.current.requestId = null
        programmaticScrollUnlockTimeoutRef.current = null
      }, PROGRAMMATIC_SCROLL_LOCK_TIMEOUT_MS)
    },
    []
  )

  const scrollToUserAnchor = useCallback(
    (
      anchorId: string,
      options?: {
        persist?: boolean
        smooth?: boolean
        requestId?: string | null
      }
    ) => {
      const anchor = userAnchorMap.get(anchorId)
      if (!anchor) return false

      const prefersReduced = prefersReducedMotion()
      const smooth = (options?.smooth ?? true) && !prefersReduced
      const virtualizer = virtualizerRef.current
      const stickToBottom = stickToBottomRef.current
      const viewport = stickToBottom?.scrollRef.current
      const row = rowElementRefs.current.get(anchor.itemKey)

      if (!viewport || (!virtualizer && !row)) {
        return false
      }

      armProgrammaticScrollLock(anchorId, options?.requestId ?? null)
      stickToBottom?.stopScroll()

      if (virtualizer) {
        virtualizer.scrollToIndex(anchor.rowIndex, {
          align: "center",
          smooth,
        })
      }

      if (row) {
        scrollMountedRowToCenter(row, viewport, smooth)
      } else if (!smooth && virtualizer && stickToBottom) {
        forceScrollAnchorToCenter(anchor, virtualizer, viewport, stickToBottom)
      }

      if (options?.persist ?? true) {
        persistAnchorSelection(anchorId)
      }
      setActiveAnchorId(anchorId)
      setConversationActiveAnchor(conversationId, anchorId)
      return true
    },
    [
      armProgrammaticScrollLock,
      conversationId,
      persistAnchorSelection,
      userAnchorMap,
    ]
  )

  useEffect(() => {
    setConversationActiveAnchor(conversationId, activeAnchorId)
  }, [activeAnchorId, conversationId])

  useEffect(() => {
    if (typeof window === "undefined") return
    restoreAttemptedRef.current = false
    pendingScrollAnchorIdRef.current = null

    const savedAnchorId = loadConversationUserAnchor(storageConversationId)
    lastPersistedAnchorIdRef.current = savedAnchorId
    if (savedAnchorId) {
      pendingScrollAnchorIdRef.current = savedAnchorId
      setAnchorRestoreState({
        conversationId: storageConversationId,
        pending: true,
      })
      return
    }

    pendingScrollAnchorIdRef.current = "__bottom__"
    setAnchorRestoreState({
      conversationId: storageConversationId,
      pending: true,
    })
  }, [storageConversationId])

  useEffect(() => {
    const pendingTarget = pendingScrollAnchorIdRef.current
    if (!pendingTarget || restoreAttemptedRef.current || detailLoading) return

    if (pendingTarget === "__bottom__") {
      let cancelled = false
      let currentRafId: number | null = null
      let settledFrames = 0

      const finishBottomRestore = () => {
        restoreAttemptedRef.current = true
        pendingScrollAnchorIdRef.current = null
        clearProgrammaticScrollLock()
        setAnchorRestoreState({
          conversationId: storageConversationId,
          pending: false,
        })
        rafRestoreRef.current = null
      }

      const runBottomRestore = () => {
        if (cancelled) return

        const stickToBottom = stickToBottomRef.current
        const viewport = stickToBottom?.scrollRef.current
        if (!stickToBottom || !viewport) {
          currentRafId = window.requestAnimationFrame(runBottomRestore)
          rafRestoreRef.current = currentRafId
          return
        }

        stickToBottom.scrollToBottom()

        const distanceFromBottom =
          viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
        if (distanceFromBottom <= 2) {
          settledFrames += 1
        } else {
          settledFrames = 0
        }

        if (settledFrames >= RESTORE_BOTTOM_SETTLED_FRAMES) {
          finishBottomRestore()
          return
        }

        currentRafId = window.requestAnimationFrame(runBottomRestore)
        rafRestoreRef.current = currentRafId
      }

      currentRafId = window.requestAnimationFrame(runBottomRestore)
      rafRestoreRef.current = currentRafId
      return () => {
        cancelled = true
        if (currentRafId !== null) {
          window.cancelAnimationFrame(currentRafId)
        }
        if (rafRestoreRef.current === currentRafId) {
          rafRestoreRef.current = null
        }
      }
    }

    const anchorId = pendingTarget
    const anchor = userAnchorMap.get(anchorId)

    if (anchor) {
      let cancelled = false
      let framesRemaining = RESTORE_SCROLL_PASSES
      let currentRafId: number | null = null

      armProgrammaticScrollLock(anchorId)

      const finishRestore = () => {
        restoreAttemptedRef.current = true
        pendingScrollAnchorIdRef.current = null
        clearProgrammaticScrollLock()
        setActiveAnchorId(anchorId)
        setAnchorRestoreState({
          conversationId: storageConversationId,
          pending: false,
        })
        rafRestoreRef.current = null
      }

      const runRestorePass = () => {
        if (cancelled) return

        const virtualizer = virtualizerRef.current
        const stickToBottom = stickToBottomRef.current
        const viewport = stickToBottom?.scrollRef.current

        if (!virtualizer || !viewport || !stickToBottom) {
          framesRemaining -= 1
          if (framesRemaining <= 0) {
            finishRestore()
            return
          }
          currentRafId = window.requestAnimationFrame(runRestorePass)
          rafRestoreRef.current = currentRafId
          return
        }

        forceScrollAnchorToCenter(anchor, virtualizer, viewport, stickToBottom)
        const row = rowElementRefs.current.get(anchor.itemKey)
        if (row) {
          scrollMountedRowToCenter(row, viewport, false)
        }

        const restoreSettled = row
          ? isRowNearViewportCenter(row, viewport)
          : isVirtualRowNearViewportCenter(anchor, virtualizer, viewport)
        framesRemaining -= 1

        if (restoreSettled || framesRemaining <= 0) {
          finishRestore()
          return
        }

        currentRafId = window.requestAnimationFrame(runRestorePass)
        rafRestoreRef.current = currentRafId
      }

      currentRafId = window.requestAnimationFrame(runRestorePass)
      rafRestoreRef.current = currentRafId
      return () => {
        cancelled = true
        if (currentRafId !== null) {
          window.cancelAnimationFrame(currentRafId)
        }
        if (rafRestoreRef.current === currentRafId) {
          rafRestoreRef.current = null
        }
      }
    }

    if (userAnchors.length === 0) {
      if (session?.detail) {
        restoreAttemptedRef.current = true
        pendingScrollAnchorIdRef.current = null
        persistAnchorSelection(null)
        clearProgrammaticScrollLock()
        setAnchorRestoreState({
          conversationId: storageConversationId,
          pending: false,
        })
      }
      return
    }

    restoreAttemptedRef.current = true
    pendingScrollAnchorIdRef.current = null
    clearProgrammaticScrollLock()
    setAnchorRestoreState({
      conversationId: storageConversationId,
      pending: false,
    })
  }, [
    armProgrammaticScrollLock,
    clearProgrammaticScrollLock,
    detailLoading,
    persistAnchorSelection,
    session?.detail,
    storageConversationId,
    userAnchorMap,
    userAnchors.length,
  ])

  useEffect(() => {
    let retryFrameId: number | null = null

    const attemptScrollRequest = (
      detail: {
        conversationId: number
        anchorId: string
        requestId: string
      },
      attempt = 0
    ) => {
      if (detail.conversationId !== conversationId) return

      const currentLock = programmaticScrollLockRef.current
      if (
        currentLock.requestId === detail.requestId &&
        currentLock.targetAnchorId === detail.anchorId
      ) {
        return
      }

      const didScroll = scrollToUserAnchor(detail.anchorId, {
        persist: true,
        smooth: true,
        requestId: detail.requestId,
      })

      if (didScroll) {
        clearLatestConversationAnchorScrollRequest(
          detail.conversationId,
          detail.requestId
        )
        restoreAttemptedRef.current = true
        pendingScrollAnchorIdRef.current = null
        if (retryFrameId !== null) {
          window.cancelAnimationFrame(retryFrameId)
          retryFrameId = null
        }
        return
      }

      pendingScrollAnchorIdRef.current = detail.anchorId
      restoreAttemptedRef.current = false

      if (attempt >= RESTORE_SCROLL_PASSES) {
        return
      }

      if (retryFrameId !== null) {
        window.cancelAnimationFrame(retryFrameId)
      }
      retryFrameId = window.requestAnimationFrame(() => {
        retryFrameId = null
        attemptScrollRequest(detail, attempt + 1)
      })
    }

    const latestRequest =
      getLatestConversationAnchorScrollRequest(conversationId)
    if (latestRequest) {
      pendingScrollAnchorIdRef.current = latestRequest.anchorId
      restoreAttemptedRef.current = false
      attemptScrollRequest(latestRequest)
    }

    const unsubscribe = addConversationAnchorScrollRequestListener((detail) => {
      attemptScrollRequest(detail)
    })

    return () => {
      unsubscribe()
      if (retryFrameId !== null) {
        window.cancelAnimationFrame(retryFrameId)
      }
    }
  }, [conversationId, scrollToUserAnchor])

  useEffect(
    () => () => {
      if (rafRestoreRef.current !== null) {
        window.cancelAnimationFrame(rafRestoreRef.current)
        rafRestoreRef.current = null
      }
      clearProgrammaticScrollLock()
      setConversationActiveAnchor(conversationId, null)
    },
    [clearProgrammaticScrollLock, conversationId]
  )

  const renderThreadItem = useCallback(
    (item: ThreadRenderItem) => {
      switch (item.kind) {
        case "turn": {
          const pt = item.isRoleTransition ? 16 : 0
          const itemKey = item.key
          const isActiveUserAnchor =
            item.group.role === "user" &&
            item.anchorId !== null &&
            item.anchorId === activeAnchorId

          return (
            <div
              ref={(node) => {
                if (node) {
                  rowElementRefs.current.set(itemKey, node)
                } else {
                  rowElementRefs.current.delete(itemKey)
                }
              }}
              className={cn(
                "relative transition-[transform,filter] duration-300 ease-out motion-reduce:transition-none",
                isActiveUserAnchor &&
                  "translate-x-[2px] drop-shadow-[0_6px_18px_rgba(59,130,246,0.08)]"
              )}
              style={pt > 0 ? { paddingTop: pt } : undefined}
            >
              {isActiveUserAnchor ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-1 -left-1 w-20 rounded-r-full bg-gradient-to-r from-primary/10 via-primary/5 to-transparent opacity-100 blur-xl transition-opacity duration-300 motion-reduce:transition-none"
                />
              ) : null}
              <HistoricalMessageGroup
                group={item.group}
                dimmed={item.phase === "optimistic"}
                showStats={item.showStats}
                previousUserIndex={item.previousUserIndex}
                isResponseComplete={item.phase === "persisted"}
              />
            </div>
          )
        }
        case "typing":
          return <PendingTypingIndicator />
        default:
          return null
      }
    },
    [activeAnchorId]
  )

  const emptyState = useMemo(
    () =>
      hideEmptyState ? null : (
        <div className="px-4 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            {t("emptyConversation")}
          </p>
        </div>
      ),
    [hideEmptyState, t]
  )

  const agentPlanOverlayKey = liveMessage?.id ?? `history-${conversationId}`

  const hasRenderableContent = threadItems.length > 0 || Boolean(liveMessage)

  if (detailLoading && !hasRenderableContent) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      </div>
    )
  }

  // ACP load failures always replace content: even when the local DB has
  // the conversation, the agent can't resume it, so silently rendering
  // the history would mislead the user into thinking a follow-up message
  // would extend the same thread.
  const blockingLoadError = acpLoadError ?? null
  const fallbackLoadError =
    detailError && !hasRenderableContent ? detailError : null
  const renderedLoadError = blockingLoadError ?? fallbackLoadError
  if (renderedLoadError) {
    const showActions = Boolean(onReload || onNewSession)
    const reloading = detailLoading
    return (
      <div role="alert" className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <AlertCircle
            aria-hidden="true"
            className="h-8 w-8 text-destructive"
          />
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{t("errorTitle")}</h3>
            <p className="text-sm text-muted-foreground break-words">
              {renderedLoadError}
            </p>
          </div>
          {showActions && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {onReload && (
                <Button
                  size="sm"
                  onClick={onReload}
                  disabled={reloading}
                  aria-busy={reloading}
                >
                  {reloading ? (
                    <Loader2
                      aria-hidden="true"
                      className="me-1.5 h-4 w-4 animate-spin"
                    />
                  ) : (
                    <RefreshCw aria-hidden="true" className="me-1.5 h-4 w-4" />
                  )}
                  {t("errorActionReload")}
                </Button>
              )}
              {onNewSession && (
                <Button size="sm" variant="outline" onClick={onNewSession}>
                  <Plus aria-hidden="true" className="me-1.5 h-4 w-4" />
                  {t("errorActionNewSession")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <MessageThread
        className="flex-1 min-h-0"
        resize={shouldUseSmoothResize ? "smooth" : undefined}
        contextRef={stickToBottomRef}
      >
        <AutoScrollOnSend signal={sendSignal} />
        <AutoScrollOnLiveTail
          isStreaming={showPromptingState}
          tailSignature={liveTailSignature}
        />
        <ActiveUserAnchorTracker
          detailLoading={detailLoading}
          userAnchors={userAnchors}
          virtualizerRef={virtualizerRef}
          persistAnchorSelection={persistAnchorSelection}
          onActiveAnchorChange={setActiveAnchorId}
          suspendPersistence={suspendAnchorPersistence}
          programmaticScrollLockRef={programmaticScrollLockRef}
        />
        <VirtualizedMessageThread
          items={threadItems}
          getItemKey={(item) => item.key}
          renderItem={renderThreadItem}
          emptyState={emptyState}
          virtualizerRef={virtualizerRef}
        />
        <MessageThreadScrollButton />
      </MessageThread>
      {liveMessage && showPromptingState && (
        <LiveTurnStats
          message={liveMessage}
          agentType={agentType}
          isStreaming={showPromptingState}
        />
      )}
      <AgentPlanOverlay
        key={agentPlanOverlayKey}
        message={liveMessage ?? null}
        entries={historicalPlanEntries}
        planKey={historicalPlanKey}
        visible={showPromptingState}
        defaultExpanded={showPromptingState}
        isStreaming={showPromptingState}
      />
    </div>
  )
}
