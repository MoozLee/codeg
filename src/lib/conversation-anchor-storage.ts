import type { ContentBlock } from "@/lib/types"

const STORAGE_KEY_PREFIX = "codeg:conversation-user-anchor"
const USER_MESSAGE_PREVIEW_MAX_LENGTH = 96
const CONVERSATION_ANCHOR_SCROLL_REQUEST_EVENT =
  "codeg:conversation-anchor-scroll-request"
const PREVIEW_WORD_BOUNDARY_MIN_RATIO = 0.6

const activeAnchorByConversation = new Map<number, string | null>()
const latestScrollRequestByConversation = new Map<
  number,
  ConversationAnchorScrollRequestDetail
>()
const activeAnchorSubscribers = new Set<() => void>()

function buildStorageKey(conversationId: number): string {
  return `${STORAGE_KEY_PREFIX}:${conversationId}`
}

function notifyActiveAnchorSubscribers(): void {
  activeAnchorSubscribers.forEach((listener) => listener())
}

export interface ConversationAnchorScrollRequestDetail {
  conversationId: number
  anchorId: string
  requestId: string
}

export function loadConversationUserAnchor(
  conversationId: number
): string | null {
  if (typeof window === "undefined") return null
  try {
    const value = localStorage.getItem(buildStorageKey(conversationId))
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export function saveConversationUserAnchor(
  conversationId: number,
  anchorId: string | null
): void {
  if (typeof window === "undefined") return
  try {
    const key = buildStorageKey(conversationId)
    if (anchorId && anchorId.length > 0) {
      localStorage.setItem(key, anchorId)
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

export function extractUserMessageText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is { type: "text"; text: string } => {
      return block.type === "text"
    })
    .map((block) => block.text)
    .join("\n")
}

function normalizePreviewText(text: string): string {
  return text
    .replace(/```(?:[^\n`]*)\n?([\s\S]*?)```/g, " $1 ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+[.)]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim()
}

function truncatePreviewText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  const sliceEnd = Math.max(maxLength - 1, 1)
  const sliced = text.slice(0, sliceEnd)
  const minBoundaryIndex = Math.floor(
    sliceEnd * PREVIEW_WORD_BOUNDARY_MIN_RATIO
  )
  const lastWhitespaceIndex = sliced.search(/\s+[^\s]*$/)

  if (lastWhitespaceIndex >= minBoundaryIndex) {
    return `${sliced.slice(0, lastWhitespaceIndex).trimEnd()}…`
  }

  return `${sliced.trimEnd()}…`
}

export function countConversationUserMessageImages(
  blocks: ContentBlock[]
): number {
  return blocks.filter((block) => block.type === "image").length
}

export function buildConversationUserMessagePreview(
  blocks: ContentBlock[],
  fallback?: string
): string | null {
  const text = normalizePreviewText(extractUserMessageText(blocks))

  if (!text) {
    return fallback ?? null
  }

  return truncatePreviewText(text, USER_MESSAGE_PREVIEW_MAX_LENGTH)
}

export function getConversationActiveAnchor(
  conversationId: number
): string | null {
  return activeAnchorByConversation.get(conversationId) ?? null
}

export function setConversationActiveAnchor(
  conversationId: number,
  anchorId: string | null
): void {
  const previous = activeAnchorByConversation.get(conversationId) ?? null
  if (previous === anchorId) {
    return
  }

  if (anchorId) {
    activeAnchorByConversation.set(conversationId, anchorId)
  } else {
    activeAnchorByConversation.delete(conversationId)
  }

  notifyActiveAnchorSubscribers()
}

export function subscribeConversationAnchorState(
  listener: () => void
): () => void {
  activeAnchorSubscribers.add(listener)
  return () => {
    activeAnchorSubscribers.delete(listener)
  }
}

export function emitConversationAnchorScrollRequest(detail: {
  conversationId: number
  anchorId: string
}): void {
  if (typeof window === "undefined") return

  const requestDetail: ConversationAnchorScrollRequestDetail = {
    ...detail,
    requestId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  }

  latestScrollRequestByConversation.set(detail.conversationId, requestDetail)
  window.dispatchEvent(
    new CustomEvent<ConversationAnchorScrollRequestDetail>(
      CONVERSATION_ANCHOR_SCROLL_REQUEST_EVENT,
      {
        detail: requestDetail,
      }
    )
  )
}

export function getLatestConversationAnchorScrollRequest(
  conversationId: number
): ConversationAnchorScrollRequestDetail | null {
  return latestScrollRequestByConversation.get(conversationId) ?? null
}

export function clearLatestConversationAnchorScrollRequest(
  conversationId: number,
  requestId?: string
): void {
  const current = latestScrollRequestByConversation.get(conversationId)
  if (!current) return
  if (requestId && current.requestId !== requestId) return
  latestScrollRequestByConversation.delete(conversationId)
}

export function addConversationAnchorScrollRequestListener(
  listener: (detail: ConversationAnchorScrollRequestDetail) => void
): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }

  const handler = (event: Event) => {
    const customEvent =
      event as CustomEvent<ConversationAnchorScrollRequestDetail>
    latestScrollRequestByConversation.set(
      customEvent.detail.conversationId,
      customEvent.detail
    )
    listener(customEvent.detail)
  }

  window.addEventListener(CONVERSATION_ANCHOR_SCROLL_REQUEST_EVENT, handler)
  return () => {
    window.removeEventListener(
      CONVERSATION_ANCHOR_SCROLL_REQUEST_EVENT,
      handler
    )
  }
}
