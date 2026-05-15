"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isDesktop } from "@/lib/platform"
import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  BookOpenText,
  Check,
  ChevronUp,
  Cog,
  FileSearch,
  GitFork,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Paperclip,
  Plus,
  Search,
  Send,
  Command,
  Sparkles,
  Square,
  X,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ImagePreviewDialog } from "@/components/ui/image-preview-dialog"
import { AgentIcon } from "@/components/agent-icon"
import { cn, randomUUID } from "@/lib/utils"
import { matchShortcutEvent } from "@/lib/keyboard-shortcuts"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { readFileBase64, quickMessagesList } from "@/lib/api"
import { openFileDialog } from "@/lib/platform"
import { disposeTauriListener } from "@/lib/tauri-listener"
import type {
  AgentSkillItem,
  AgentType,
  AvailableCommandInfo,
  ExpertListItem,
  PromptCapabilitiesInfo,
  PromptDraft,
  PromptInputBlock,
  QuickMessage,
  SessionConfigOptionInfo,
  SessionModeInfo,
} from "@/lib/types"
import {
  ATTACH_FILE_TO_SESSION_EVENT,
  APPEND_TEXT_TO_SESSION_EVENT,
  type AttachFileToSessionDetail,
  type AppendTextToSessionDetail,
} from "@/lib/session-attachment-events"
import {
  ConversationContextBar,
  ConversationFolderBranchPicker,
  useConversationFolderBranchPickerVisible,
} from "@/components/chat/conversation-context-bar"
import {
  InlineModeSelector,
  ModeSelector,
} from "@/components/chat/mode-selector"
import {
  InlineSessionConfigSelector,
  SessionConfigSelector,
} from "@/components/chat/session-config-selector"
import {
  getExpertIcon,
  pickExpertLocalized,
} from "@/components/chat/experts-command-menu"
import { FileMentionMenu } from "@/components/chat/file-mention-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import { useFileTree } from "@/hooks/use-file-tree"
import { useBuiltInExperts } from "@/hooks/use-built-in-experts"
import { useAgentExperts } from "@/hooks/use-agent-experts"
import { useAgentSkills } from "@/hooks/use-agent-skills"
import { joinFsPath } from "@/lib/path-utils"
import {
  clearMessageInputDraft,
  loadMessageInputDraft,
  saveMessageInputDraft,
  type MessageInputPastedTextEntry,
} from "@/lib/message-input-draft"

interface MessageInputProps {
  onSend: (draft: PromptDraft, modeId?: string | null) => void
  placeholder?: string
  defaultPath?: string
  disabled?: boolean
  autoFocus?: boolean
  onFocus?: () => void
  className?: string
  isPrompting?: boolean
  onCancel?: () => void
  modes?: SessionModeInfo[]
  configOptions?: SessionConfigOptionInfo[]
  modeLoading?: boolean
  configOptionsLoading?: boolean
  selectedModeId?: string | null
  onModeChange?: (modeId: string) => void
  onConfigOptionChange?: (configId: string, value: string | boolean) => void
  agentType?: AgentType | null
  availableCommands?: AvailableCommandInfo[] | null
  promptCapabilities: PromptCapabilitiesInfo
  attachmentTabId?: string | null
  draftStorageKey?: string | null
  isActive?: boolean
  onEnqueue?: (draft: PromptDraft, modeId: string | null) => void
  editingDraftText?: string | null
  isEditingQueueItem?: boolean
  onSaveQueueEdit?: (draft: PromptDraft) => void
  onCancelQueueEdit?: () => void
  onForkSend?: (draft: PromptDraft, modeId?: string | null) => void
}

interface ResourceInputAttachment {
  id: string
  type: "resource"
  kind: "link" | "embedded"
  uri: string
  name: string
  mimeType: string | null
  text?: string | null
  blob?: string | null
}

interface ImageInputAttachment {
  id: string
  type: "image"
  data: string
  uri: string | null
  name: string
  mimeType: string
}

interface TextInsertionDelta {
  insertedText: string
  selectionStart: number
  selectionEnd: number
}

type InputAttachment = ResourceInputAttachment | ImageInputAttachment

const MIME_BY_EXT: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/tsx",
  jsx: "text/jsx",
  py: "text/x-python",
  rs: "text/rust",
  go: "text/x-go",
  java: "text/x-java-source",
  xml: "application/xml",
  toml: "application/toml",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
}

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

function mimeTypeFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXT[ext] ?? null
}

function toFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const encoded = normalized.split("/").map(encodeURIComponent).join("/")
  if (normalized.startsWith("/")) {
    return `file://${encoded}`
  }
  return `file:///${encoded}`
}

function hasDragFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer?.types) return false
  return Array.from(dataTransfer.types).includes("Files")
}

function pointWithinElement(
  position: { x: number; y: number },
  element: HTMLElement
): boolean {
  // Inactive conversation tabs are kept mounted at `absolute inset-0` with
  // `visibility: hidden` (see ConversationDetailPanel), so their bounding rect
  // overlaps the active tab's. Without this guard every tab's Tauri drag
  // listener would treat the same OS drop as falling inside its own input,
  // and dropped files would silently fan out across every open conversation.
  const style = element.ownerDocument?.defaultView?.getComputedStyle(element)
  if (style) {
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      style.pointerEvents === "none"
    ) {
      return false
    }
  }
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  const dpr = window.devicePixelRatio || 1
  const candidates = [
    { x: position.x, y: position.y },
    { x: position.x / dpr, y: position.y / dpr },
  ]
  return candidates.some(
    (point) =>
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
  )
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read blob"))
    }
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unexpected non-string blob reader result"))
        return
      }
      const markerIndex = reader.result.indexOf(",")
      resolve(
        markerIndex >= 0 ? reader.result.slice(markerIndex + 1) : reader.result
      )
    }
    reader.readAsDataURL(blob)
  })
}

function getFilePath(file: File): string | null {
  const withPath = file as File & { path?: string; webkitRelativePath?: string }
  if (typeof withPath.path === "string" && withPath.path.trim().length > 0) {
    return withPath.path
  }
  if (
    typeof withPath.webkitRelativePath === "string" &&
    withPath.webkitRelativePath.trim().length > 0
  ) {
    return withPath.webkitRelativePath
  }
  return null
}

const TEXT_LIKE_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/javascript",
  "application/typescript",
]
const DRAG_DROP_IMAGE_MAX_BYTES = 20_000_000
const PASTED_TEXT_COLLAPSE_LENGTH_THRESHOLD = 800
const PASTED_TEXT_COLLAPSE_NEWLINE_THRESHOLD = 2
const PASTED_TEXT_PLACEHOLDER_PATTERN =
  /\[Pasted text #(\d+)(?: \+\d+ lines)?\]/g

function countNewlines(value: string): number {
  return (value.match(/\n/g) ?? []).length
}

function shouldCollapsePastedText(value: string): boolean {
  if (value.length > PASTED_TEXT_COLLAPSE_LENGTH_THRESHOLD) return true
  return countNewlines(value) > PASTED_TEXT_COLLAPSE_NEWLINE_THRESHOLD
}

function formatPastedTextPlaceholder(id: number, newlineCount: number): string {
  if (newlineCount > 0) return `[Pasted text #${id} +${newlineCount} lines]`
  return `[Pasted text #${id}]`
}

function expandPastedTextPlaceholders(
  value: string,
  pastedTexts: MessageInputPastedTextEntry[]
): string {
  if (pastedTexts.length === 0) return value
  const contentById = new Map(
    pastedTexts.map((entry) => [entry.id.toString(), entry.content])
  )
  return value.replace(PASTED_TEXT_PLACEHOLDER_PATTERN, (match, id: string) => {
    return contentById.get(id) ?? match
  })
}

function collectPastedTextPlaceholderIds(value: string): Set<number> {
  const ids = new Set<number>()
  PASTED_TEXT_PLACEHOLDER_PATTERN.lastIndex = 0
  let match = PASTED_TEXT_PLACEHOLDER_PATTERN.exec(value)
  while (match) {
    ids.add(Number(match[1]))
    match = PASTED_TEXT_PLACEHOLDER_PATTERN.exec(value)
  }
  PASTED_TEXT_PLACEHOLDER_PATTERN.lastIndex = 0
  return ids
}

function prunePastedTextsForText(
  value: string,
  pastedTexts: MessageInputPastedTextEntry[]
): MessageInputPastedTextEntry[] {
  if (pastedTexts.length === 0) return pastedTexts
  const referencedIds = collectPastedTextPlaceholderIds(value)
  if (referencedIds.size === 0) return []
  return pastedTexts.filter((entry) => referencedIds.has(entry.id))
}

function nextPastedTextId(entries: MessageInputPastedTextEntry[]): number {
  return entries.reduce((maxId, entry) => Math.max(maxId, entry.id), 0) + 1
}

function insertTextAtRange(
  value: string,
  insertion: string,
  start: number,
  end: number
): string {
  return value.slice(0, start) + insertion + value.slice(end)
}

function normalizeSelectionRange(
  start: number,
  end: number,
  valueLength: number
): { start: number; end: number } {
  const normalizedStart = Math.max(0, Math.min(start, valueLength))
  const normalizedEnd = Math.max(normalizedStart, Math.min(end, valueLength))
  return { start: normalizedStart, end: normalizedEnd }
}

function inferInsertedTextDelta(
  previousText: string,
  value: string,
  cursorPos: number
): TextInsertionDelta | null {
  const boundedCursor = Math.max(0, Math.min(cursorPos, value.length))
  let prefixLength = 0
  const maxPrefixLength = Math.min(previousText.length, boundedCursor)
  while (
    prefixLength < maxPrefixLength &&
    previousText[prefixLength] === value[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  const maxSuffixLength = Math.min(
    previousText.length - prefixLength,
    value.length - boundedCursor
  )
  while (
    suffixLength < maxSuffixLength &&
    previousText[previousText.length - 1 - suffixLength] ===
      value[value.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  const insertedEnd = value.length - suffixLength
  if (insertedEnd <= prefixLength) return null

  const replacedEnd = previousText.length - suffixLength
  const insertedText = value.slice(prefixLength, insertedEnd)
  if (insertedText.length === 0) return null

  return {
    insertedText,
    selectionStart: prefixLength,
    selectionEnd: replacedEnd,
  }
}

function isTextLikeFile(file: File): boolean {
  const mime = file.type.toLowerCase()
  if (mime) {
    if (TEXT_LIKE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
      return true
    }
  }
  const ext = file.name.split(".").pop()?.toLowerCase()
  if (!ext) return false
  return Boolean(
    MIME_BY_EXT[ext]?.startsWith("text/") ||
    ["json", "yaml", "yml", "xml", "toml", "md", "csv"].includes(ext)
  )
}

function buildClipboardResourceUri(name: string): string {
  const normalizedName = name.trim() || "clipboard-resource"
  return `clipboard://${encodeURIComponent(normalizedName)}-${randomUUID()}`
}

function buildDataUri(base64Data: string, mimeType: string | null): string {
  const safeMime =
    mimeType && mimeType.trim() ? mimeType : "application/octet-stream"
  return `data:${safeMime};base64,${base64Data}`
}

function SelectorLoadingChip({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
      <span>{label}</span>
    </div>
  )
}

export function MessageInput({
  onSend,
  placeholder,
  defaultPath,
  disabled = false,
  autoFocus = false,
  onFocus,
  className,
  isPrompting = false,
  onCancel,
  modes,
  configOptions,
  modeLoading = false,
  configOptionsLoading = false,
  selectedModeId,
  onModeChange,
  onConfigOptionChange,
  agentType,
  availableCommands,
  promptCapabilities,
  attachmentTabId,
  draftStorageKey,
  isActive = false,
  onEnqueue,
  editingDraftText,
  isEditingQueueItem = false,
  onSaveQueueEdit,
  onCancelQueueEdit,
  onForkSend,
}: MessageInputProps) {
  const t = useTranslations("Folder.chat.messageInput")
  const tQueue = useTranslations("Folder.chat.messageQueue")
  const tExperts = useTranslations("ExpertsSettings")
  const locale = useLocale()
  const builtInExperts = useBuiltInExperts()
  const expertIdSet = useMemo(
    () => new Set(builtInExperts.map((item) => item.metadata.id)),
    [builtInExperts]
  )
  // Experts linked to the current agent via symlinks in the settings page.
  // Kept so the dedicated expert (Sparkles) button can still surface them.
  const availableExperts = useAgentExperts(agentType ?? null)
  // The `$` prefix autocomplete is Codex-only: Codex advertises very few
  // native slash commands, so we augment the dropdown with the agent's
  // skills read from disk. Other agents already surface their full command
  // set through ACP `availableCommands`, so injecting skills there would
  // be duplicate/extra UI noise — skip the skills fetch for them entirely.
  const skillAgentType = agentType === "codex" ? "codex" : null
  // Pass the working dir so we see both global skills and folder-scoped
  // project skills (e.g. `{folder}/.codex/skills`). Without this, users
  // only ever saw global skills in the `$` autocomplete.
  const availableSkills = useAgentSkills(skillAgentType, defaultPath ?? null)
  // Expert skills are symlinked into the agent's skill directories, so they
  // also show up in `acp_list_agent_skills`. Strip them out — experts remain
  // reachable via the expert button, and the `$` list is skills-only.
  const nonExpertSkills = useMemo(
    () => availableSkills.filter((skill) => !expertIdSet.has(skill.id)),
    [availableSkills, expertIdSet]
  )
  const expertPrefix = agentType === "codex" ? "$" : "/"
  // Stable presentation order for expert categories in the button
  // dropdown. Keep this in sync with experts-settings.tsx so both surfaces
  // group experts the same way.
  const groupedExperts = useMemo(() => {
    const CATEGORY_SORT: Record<string, number> = {
      discovery: 1,
      planning: 2,
      execution: 3,
      quality: 4,
      debugging: 5,
      review: 6,
      meta: 7,
    }
    const groups = new Map<string, typeof availableExperts>()
    const sorted = [...availableExperts].sort((a, b) => {
      const ca = CATEGORY_SORT[a.metadata.category] ?? 99
      const cb = CATEGORY_SORT[b.metadata.category] ?? 99
      if (ca !== cb) return ca - cb
      const sa = a.metadata.sort_order ?? 0
      const sb = b.metadata.sort_order ?? 0
      if (sa !== sb) return sa - sb
      return a.metadata.id.localeCompare(b.metadata.id)
    })
    for (const item of sorted) {
      const list = groups.get(item.metadata.category) ?? []
      list.push(item)
      groups.set(item.metadata.category, list)
    }
    return Array.from(groups.entries()).sort(
      (a, b) => (CATEGORY_SORT[a[0]] ?? 99) - (CATEGORY_SORT[b[0]] ?? 99)
    )
  }, [availableExperts])
  const translateExpertCategory = useCallback(
    (category: string): string => {
      switch (category) {
        case "discovery":
          return tExperts("categories.discovery")
        case "planning":
          return tExperts("categories.planning")
        case "execution":
          return tExperts("categories.execution")
        case "quality":
          return tExperts("categories.quality")
        case "debugging":
          return tExperts("categories.debugging")
        case "review":
          return tExperts("categories.review")
        case "meta":
          return tExperts("categories.meta")
        default:
          return category
      }
    },
    [tExperts]
  )
  const { shortcuts } = useShortcutSettings()
  const effectiveDraftStorageKey = draftStorageKey ?? null
  const resolvedPlaceholder = placeholder ?? t("askAnything")
  const initialDraftState = useMemo(() => {
    if (!effectiveDraftStorageKey) return null
    return loadMessageInputDraft(effectiveDraftStorageKey)
  }, [effectiveDraftStorageKey])
  const [text, setText] = useState(() => initialDraftState?.text ?? "")
  const [pastedTexts, setPastedTexts] = useState<MessageInputPastedTextEntry[]>(
    () => initialDraftState?.pastedTexts ?? []
  )
  const [attachments, setAttachments] = useState<InputAttachment[]>([])
  const [inputExpanded, setInputExpanded] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [quickMessages, setQuickMessages] = useState<QuickMessage[]>([])
  const [quickMessagesLoading, setQuickMessagesLoading] = useState(false)
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(
    null
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastDomDropAtRef = useRef(0)
  const composingRef = useRef(false)
  const cursorPosRef = useRef<number | null>(null)
  const textRef = useRef(text)
  const pastedTextsRef = useRef(pastedTexts)
  const disabledRef = useRef(disabled)
  const isPromptingRef = useRef(isPrompting)

  useEffect(() => {
    if (isActive && !disabled && !isPrompting) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    }
  }, [isActive, disabled, isPrompting])
  const dragActiveRef = useRef(false)
  const canAttachImages = promptCapabilities.image

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    pastedTextsRef.current = pastedTexts
  }, [pastedTexts])

  const clearPastedTexts = useCallback(() => {
    pastedTextsRef.current = []
    setPastedTexts([])
  }, [])

  const syncPastedTextsForText = useCallback((value: string) => {
    const next = prunePastedTextsForText(value, pastedTextsRef.current)
    if (next.length === pastedTextsRef.current.length) return
    pastedTextsRef.current = next
    setPastedTexts(next)
  }, [])

  const insertCollapsedPastedText = useCallback(
    (
      pastedText: string,
      selectionStart: number,
      selectionEnd: number,
      baseText: string = textRef.current
    ): { nextText: string; placeholder: string } => {
      const { start, end } = normalizeSelectionRange(
        selectionStart,
        selectionEnd,
        baseText.length
      )
      const newId = nextPastedTextId(pastedTextsRef.current)
      const placeholder = formatPastedTextPlaceholder(
        newId,
        countNewlines(pastedText)
      )
      const nextText = insertTextAtRange(baseText, placeholder, start, end)

      pastedTextsRef.current = [
        ...pastedTextsRef.current,
        { id: newId, content: pastedText },
      ]
      setPastedTexts(pastedTextsRef.current)
      setText(nextText)
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        const pos = start + placeholder.length
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })

      return { nextText, placeholder }
    },
    []
  )

  // `field-sizing-content` 触发的尺寸调整发生在浏览器布局阶段，原生 caret-
  // into-view 滚动赶不上，导致光标停在末尾时新行被裁在可视区外。用 rAF 等
  // 到本帧所有同步 `setSelectionRange` 调用之后再判断光标位置——程序化插入
  // 路径（换行快捷键、快捷消息、斜杠命令等）都先 `setText` 再 rAF 设光标，
  // 这里同样走 rAF 才能保证光标已经落到末尾。
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const id = requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      if ((el.selectionStart ?? 0) >= el.value.length) {
        el.scrollTop = el.scrollHeight
      }
    })
    return () => cancelAnimationFrame(id)
  }, [text])

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    isPromptingRef.current = isPrompting
  }, [isPrompting])

  // Load external draft text when editing a queue item
  const prevEditingDraftRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      isEditingQueueItem &&
      editingDraftText != null &&
      editingDraftText !== prevEditingDraftRef.current
    ) {
      prevEditingDraftRef.current = editingDraftText
      clearPastedTexts()
      setText(editingDraftText)
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    } else if (!isEditingQueueItem) {
      prevEditingDraftRef.current = null
    }
  }, [isEditingQueueItem, editingDraftText, clearPastedTexts])

  const setDragActiveIfChanged = useCallback((next: boolean) => {
    if (dragActiveRef.current === next) return
    dragActiveRef.current = next
    setIsDragActive(next)
  }, [])

  useEffect(() => {
    if (!effectiveDraftStorageKey || isEditingQueueItem) return
    saveMessageInputDraft(effectiveDraftStorageKey, {
      text,
      pastedTexts,
    })
  }, [effectiveDraftStorageKey, text, pastedTexts, isEditingQueueItem])

  const availableModes = useMemo(() => modes ?? [], [modes])
  const availableConfigOptions = useMemo(
    () => configOptions ?? [],
    [configOptions]
  )
  const hasConfigOptions = availableConfigOptions.length > 0
  const hasModes = availableModes.length > 0

  const effectiveModeId = useMemo(() => {
    if (!hasModes) return null
    if (
      selectedModeId &&
      availableModes.some((mode) => mode.id === selectedModeId)
    ) {
      return selectedModeId
    }
    return availableModes[0]?.id ?? null
  }, [hasModes, selectedModeId, availableModes])
  const showModeSelector =
    hasModes && Boolean(effectiveModeId) && !hasConfigOptions
  const showModeLoading = modeLoading && !hasConfigOptions && !showModeSelector
  const showConfigLoading = configOptionsLoading && !hasConfigOptions
  const hasAnySelector =
    showConfigLoading || hasConfigOptions || showModeLoading || showModeSelector
  const hasInlineSelectors = hasConfigOptions || showModeSelector
  const hasFolderBranchPicker =
    useConversationFolderBranchPickerVisible(attachmentTabId)
  const imageAttachments = useMemo(
    () =>
      attachments.filter(
        (attachment): attachment is ImageInputAttachment =>
          attachment.type === "image"
      ),
    [attachments]
  )
  const previewAttachment = useMemo(
    () =>
      previewAttachmentId
        ? (imageAttachments.find((a) => a.id === previewAttachmentId) ?? null)
        : null,
    [previewAttachmentId, imageAttachments]
  )
  const resourceAttachments = useMemo(
    () =>
      attachments.filter(
        (attachment): attachment is ResourceInputAttachment =>
          attachment.type === "resource"
      ),
    [attachments]
  )
  const hasAttachments = attachments.length > 0
  const hasSendableContent = text.trim().length > 0 || hasAttachments

  // ── Slash command autocomplete ──
  //
  // Built-in experts are always surfaced via the Sparkles button, so any
  // agent-advertised command whose name matches an expert id is hidden
  // from the slash list to avoid showing the same item twice. For non-Codex
  // agents the dropdown only shows the agent's own `availableCommands` —
  // Codex additionally gets a `$`-triggered skills list because its native
  // command set is very small.
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  // Byte offset of the `/` or `$` character that opened the menu. Tracking the
  // position lets the user invoke a slash command mid-text (e.g. after typing
  // prose) and only replace the slash token on selection, leaving surrounding
  // content intact.
  const [slashTriggerPos, setSlashTriggerPos] = useState<number | null>(null)
  const slashTriggerPosRef = useRef<number | null>(null)
  useEffect(() => {
    slashTriggerPosRef.current = slashTriggerPos
  }, [slashTriggerPos])
  const slashCommands = useMemo(
    () => (availableCommands ?? []).filter((cmd) => !expertIdSet.has(cmd.name)),
    [availableCommands, expertIdSet]
  )
  const [slashDropdownOpen, setSlashDropdownOpen] = useState(false)
  const [slashDropdownSearch, setSlashDropdownSearch] = useState("")
  const slashDropdownInputRef = useRef<HTMLInputElement>(null)
  const filteredSlashDropdownCommands = useMemo(() => {
    const q = slashDropdownSearch.toLowerCase().trim()
    if (!q) return slashCommands
    const nameMatches: typeof slashCommands = []
    const descOnlyMatches: typeof slashCommands = []
    for (const cmd of slashCommands) {
      if (cmd.name.toLowerCase().includes(q)) {
        nameMatches.push(cmd)
      } else if (cmd.description?.toLowerCase().includes(q)) {
        descOnlyMatches.push(cmd)
      }
    }
    return [...nameMatches, ...descOnlyMatches]
  }, [slashCommands, slashDropdownSearch])
  const handleSlashDropdownOpenChange = useCallback((open: boolean) => {
    setSlashDropdownOpen(open)
    if (!open) setSlashDropdownSearch("")
  }, [])
  // Radix's MenuSubContent hardcodes its own onOpenAutoFocus that overwrites
  // any prop we pass in (see @radix-ui/react-menu MenuSubContent). To put the
  // search input in focus when the slash submenu opens, defer focus to a
  // microtask after Radix finishes its own focus dance.
  useEffect(() => {
    if (!slashDropdownOpen) return
    const id = requestAnimationFrame(() => {
      slashDropdownInputRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [slashDropdownOpen])
  const slashFilterText = useMemo(() => {
    if (!slashMenuOpen || slashTriggerPos == null) return ""
    const trigger = text[slashTriggerPos]
    if (trigger !== "/" && trigger !== "$") return ""
    const afterTrigger = text.slice(slashTriggerPos + 1)
    const endIdx = afterTrigger.search(/\s/)
    return endIdx === -1 ? afterTrigger : afterTrigger.slice(0, endIdx)
  }, [slashMenuOpen, text, slashTriggerPos])
  const filteredSlashCommands = useMemo(() => {
    if (!slashMenuOpen || slashCommands.length === 0 || slashTriggerPos == null)
      return []
    if (text[slashTriggerPos] !== "/") return []
    const filter = slashFilterText.toLowerCase()
    return slashCommands.filter((cmd) =>
      cmd.name.toLowerCase().includes(filter)
    )
  }, [slashMenuOpen, slashCommands, text, slashTriggerPos, slashFilterText])
  const filteredSlashSkills = useMemo(() => {
    // Skills autocomplete is Codex-only and triggered by `$`.
    if (agentType !== "codex") return []
    if (
      !slashMenuOpen ||
      nonExpertSkills.length === 0 ||
      slashTriggerPos == null
    )
      return []
    if (text[slashTriggerPos] !== "$") return []
    const filter = slashFilterText.toLowerCase()
    if (!filter) return nonExpertSkills
    const nameMatches: typeof nonExpertSkills = []
    const idOnlyMatches: typeof nonExpertSkills = []
    for (const skill of nonExpertSkills) {
      if (skill.name.toLowerCase().includes(filter)) {
        nameMatches.push(skill)
      } else if (skill.id.toLowerCase().includes(filter)) {
        idOnlyMatches.push(skill)
      }
    }
    return [...nameMatches, ...idOnlyMatches]
  }, [
    slashMenuOpen,
    nonExpertSkills,
    text,
    agentType,
    slashTriggerPos,
    slashFilterText,
  ])
  const slashAutocompleteCount =
    filteredSlashCommands.length + filteredSlashSkills.length

  // Keep the highlighted row inside the current result window. As the user
  // types and the filter narrows, the previously-highlighted index can point
  // past the end of the merged list (commands + experts), which would make
  // Enter/Tab a silent no-op. Clamp back to the last available row whenever
  // the count changes.
  useEffect(() => {
    if (
      slashAutocompleteCount > 0 &&
      slashSelectedIndex >= slashAutocompleteCount
    ) {
      setSlashSelectedIndex(slashAutocompleteCount - 1)
    }
  }, [slashAutocompleteCount, slashSelectedIndex])

  // Keep the highlighted row visible inside the popup when keyboard navigation
  // pushes it past the scroll viewport. Without this the cursor silently runs
  // off the rendered area when the filtered list overflows `max-h`.
  const slashMenuListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!slashMenuOpen) return
    const container = slashMenuListRef.current
    if (!container) return
    const el = container.children[slashSelectedIndex] as HTMLElement | undefined
    if (!el) return
    const elTop = el.offsetTop
    const elBottom = elTop + el.offsetHeight
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight
    if (elTop < viewTop) {
      container.scrollTop = elTop
    } else if (elBottom > viewBottom) {
      container.scrollTop = elBottom - container.clientHeight
    }
  }, [slashMenuOpen, slashSelectedIndex, slashAutocompleteCount])

  // ── @ file mention autocomplete ──
  const [atMenuOpen, setAtMenuOpen] = useState(false)
  const [atSelectedIndex, setAtSelectedIndex] = useState(0)
  const [atTriggerPos, setAtTriggerPos] = useState<number | null>(null)
  const [atFileTreeEnabled, setAtFileTreeEnabled] = useState(false)

  const { allFiles: atAllFiles } = useFileTree({
    folderPath: defaultPath,
    enabled: atFileTreeEnabled,
  })

  const filteredAtFiles = useMemo(() => {
    if (!atMenuOpen || atTriggerPos == null) return []
    // Extract the query after "@" up to the next space or end of text
    const afterAt = text.slice(atTriggerPos + 1)
    const spaceIdx = afterAt.indexOf(" ")
    const filter =
      spaceIdx === -1
        ? afterAt.toLowerCase()
        : afterAt.slice(0, spaceIdx).toLowerCase()
    if (!filter) return atAllFiles.slice(0, 50)
    const matched: typeof atAllFiles = []
    for (const f of atAllFiles) {
      if (f.lowerName.includes(filter) || f.lowerPath.includes(filter)) {
        matched.push(f)
        if (matched.length >= 50) break
      }
    }
    return matched
  }, [atMenuOpen, atTriggerPos, text, atAllFiles])

  const appendResourceLinks = useCallback(
    (
      links: Array<{
        uri: string
        name: string
        mimeType: string | null
        dedupeKey: string
      }>
    ) => {
      if (links.length === 0) return
      setAttachments((prev) => {
        const seen = new Set(
          prev.flatMap((item) =>
            item.type === "resource" && item.kind === "link" ? [item.uri] : []
          )
        )
        const next = [...prev]
        for (const link of links) {
          if (!link.uri || seen.has(link.dedupeKey)) continue
          seen.add(link.dedupeKey)
          next.push({
            id: `resource-link:${link.dedupeKey}`,
            type: "resource",
            kind: "link",
            uri: link.uri,
            name: link.name,
            mimeType: link.mimeType,
          })
        }
        return next
      })
    },
    []
  )

  const appendResourceAttachments = useCallback(
    (paths: string[]) => {
      const normalized = paths
        .filter(
          (path): path is string => typeof path === "string" && path.length > 0
        )
        .map((path) => {
          const uri = toFileUri(path)
          return {
            uri,
            name: fileNameFromPath(path),
            mimeType: mimeTypeFromPath(path),
            dedupeKey: uri,
          }
        })
      appendResourceLinks(normalized)
    },
    [appendResourceLinks]
  )

  const appendEmbeddedResources = useCallback(
    (
      resources: Array<{
        uri: string
        name: string
        mimeType: string | null
        text?: string | null
        blob?: string | null
      }>
    ) => {
      if (resources.length === 0) return
      setAttachments((prev) => [
        ...prev,
        ...resources.map((resource) => ({
          id: `resource-embedded:${randomUUID()}`,
          type: "resource" as const,
          kind: "embedded" as const,
          uri: resource.uri,
          name: resource.name,
          mimeType: resource.mimeType,
          text: resource.text ?? null,
          blob: resource.blob ?? null,
        })),
      ])
    },
    []
  )

  const appendFilesAsResources = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const pathLinks: Array<{
        uri: string
        name: string
        mimeType: string | null
        dedupeKey: string
      }> = []
      const fallbackDataLinks: Array<{
        uri: string
        name: string
        mimeType: string | null
        dedupeKey: string
      }> = []
      const embeddedResources: Array<{
        uri: string
        name: string
        mimeType: string | null
        text?: string | null
        blob?: string | null
      }> = []

      for (const file of files) {
        const path = getFilePath(file)
        const name = file.name || `resource-${randomUUID()}`
        const mimeType = file.type || mimeTypeFromPath(name)
        if (path) {
          const uri = toFileUri(path)
          pathLinks.push({
            uri,
            name: fileNameFromPath(path),
            mimeType: mimeTypeFromPath(path) ?? mimeType ?? null,
            dedupeKey: uri,
          })
          continue
        }

        if (!promptCapabilities.embedded_context) {
          const base64 = await blobToBase64(file)
          const dataUri = buildDataUri(base64, mimeType ?? null)
          fallbackDataLinks.push({
            uri: dataUri,
            name,
            mimeType: mimeType ?? null,
            dedupeKey: `${name}:${file.size}:${file.lastModified}`,
          })
          continue
        }

        const uri = buildClipboardResourceUri(name)
        if (isTextLikeFile(file)) {
          const textContent = await file.text()
          embeddedResources.push({
            uri,
            name,
            mimeType: mimeType ?? null,
            text: textContent,
          })
        } else {
          const blobContent = await blobToBase64(file)
          embeddedResources.push({
            uri,
            name,
            mimeType: mimeType ?? null,
            blob: blobContent,
          })
        }
      }

      appendResourceLinks(pathLinks)
      appendResourceLinks(fallbackDataLinks)
      appendEmbeddedResources(embeddedResources)
    },
    [
      appendEmbeddedResources,
      appendResourceLinks,
      promptCapabilities.embedded_context,
    ]
  )

  const appendImageAttachments = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const parsed = await Promise.all(
      files.map(async (file, index) => {
        const mimeType =
          file.type && file.type.startsWith("image/")
            ? file.type
            : (mimeTypeFromPath(file.name) ?? "image/png")
        const base64Data = await blobToBase64(file)
        return {
          id: `image:${Date.now()}:${index}:${randomUUID()}`,
          type: "image" as const,
          data: base64Data,
          uri: null,
          name: file.name || `image-${Date.now()}-${index + 1}`,
          mimeType,
        }
      })
    )
    setAttachments((prev) => [...prev, ...parsed])
  }, [])

  const appendImagePathAttachments = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0 || !canAttachImages) return
      const settled = await Promise.allSettled(
        paths.map(async (path, index) => {
          const data = await readFileBase64(path, DRAG_DROP_IMAGE_MAX_BYTES)
          return {
            id: `image:${Date.now()}:${index}:${randomUUID()}`,
            type: "image" as const,
            data,
            uri: toFileUri(path),
            name: fileNameFromPath(path),
            mimeType: mimeTypeFromPath(path) ?? "image/png",
          }
        })
      )

      const parsed: ImageInputAttachment[] = []
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") {
          parsed.push(result.value)
          return
        }
        console.error(
          `[MessageInput] drop image path failed (${paths[index]}):`,
          result.reason
        )
      })
      if (parsed.length === 0) return
      setAttachments((prev) => [...prev, ...parsed])
    },
    [canAttachImages]
  )

  const appendPathsFromDrop = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      const normalized = paths.filter(
        (path): path is string => typeof path === "string" && path.length > 0
      )
      if (normalized.length === 0) return

      const imagePaths: string[] = []
      const resourcePaths: string[] = []
      for (const path of normalized) {
        const mimeType = mimeTypeFromPath(path) ?? ""
        if (canAttachImages && mimeType.startsWith("image/")) {
          imagePaths.push(path)
        } else {
          resourcePaths.push(path)
        }
      }

      if (imagePaths.length > 0) {
        await appendImagePathAttachments(imagePaths)
      }
      if (resourcePaths.length > 0) {
        appendResourceAttachments(resourcePaths)
      }
    },
    [appendImagePathAttachments, appendResourceAttachments, canAttachImages]
  )

  const appendPathsFromDropRef = useRef(appendPathsFromDrop)
  useEffect(() => {
    appendPathsFromDropRef.current = appendPathsFromDrop
  }, [appendPathsFromDrop])

  const appendFilesFromInput = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const imageFiles: File[] = []
      const resourceFiles: File[] = []
      for (const file of files) {
        const mimeType = file.type || mimeTypeFromPath(file.name) || ""
        if (canAttachImages && mimeType.startsWith("image/")) {
          imageFiles.push(file)
        } else {
          resourceFiles.push(file)
        }
      }

      if (imageFiles.length > 0) {
        await appendImageAttachments(imageFiles)
      }
      if (resourceFiles.length > 0) {
        await appendFilesAsResources(resourceFiles)
      }
    },
    [appendFilesAsResources, appendImageAttachments, canAttachImages]
  )

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return
      const clipboardData = event.clipboardData
      const files = Array.from(clipboardData?.files ?? [])
      if (files.length > 0) {
        event.preventDefault()
        void appendFilesFromInput(files).catch((error) => {
          console.error("[MessageInput] paste files failed:", error)
        })
        return
      }

      const pastedText = clipboardData?.getData("text/plain") ?? ""
      if (!pastedText || !shouldCollapsePastedText(pastedText)) return

      const current = textRef.current
      const rawStart = event.currentTarget.selectionStart ?? current.length
      const rawEnd = event.currentTarget.selectionEnd ?? rawStart
      const { start, end } = normalizeSelectionRange(
        rawStart,
        rawEnd,
        current.length
      )
      event.preventDefault()
      insertCollapsedPastedText(pastedText, start, end, current)
    },
    [appendFilesFromInput, disabled, insertCollapsedPastedText]
  )

  useEffect(() => {
    if (!showModeSelector) return
    if (!effectiveModeId || !onModeChange) return
    if (effectiveModeId !== selectedModeId) {
      onModeChange(effectiveModeId)
    }
  }, [showModeSelector, effectiveModeId, selectedModeId, onModeChange])

  const handleModeSelect = useCallback(
    (modeId: string) => {
      onModeChange?.(modeId)
    },
    [onModeChange]
  )

  const handleSlashSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const pos = slashTriggerPosRef.current
      const current = textRef.current
      if (pos == null || pos < 0 || pos >= current.length) return
      const trigger = current[pos]
      if (trigger !== "/" && trigger !== "$") return
      const afterTrigger = current.slice(pos + 1)
      const endIdx = afterTrigger.search(/\s/)
      const tokenEnd = endIdx === -1 ? current.length : pos + 1 + endIdx
      const before = current.slice(0, pos + 1)
      const rest = current.slice(tokenEnd)
      const sanitized = e.target.value.replace(/\s+/g, "")
      setText(before + sanitized + rest)
      setSlashSelectedIndex(0)
    },
    []
  )

  const handleSlashSelect = useCallback((cmd: AvailableCommandInfo) => {
    const pos = slashTriggerPosRef.current
    const current = textRef.current
    const insertion = `/${cmd.name}`
    if (
      pos == null ||
      pos < 0 ||
      pos >= current.length ||
      current[pos] !== "/"
    ) {
      // Fallback path: no tracked trigger (shouldn't normally happen). Behave
      // like the legacy wholesale-replace so slash commands still work.
      setText(`${insertion} `)
      setSlashMenuOpen(false)
      setSlashTriggerPos(null)
      return
    }
    const before = current.slice(0, pos)
    const afterSlash = current.slice(pos + 1)
    const tokenMatch = afterSlash.match(/^\S*/)
    const tokenLen = tokenMatch ? tokenMatch[0].length : 0
    const rest = afterSlash.slice(tokenLen)
    const needsSpace = !/^\s/.test(rest)
    const newText = before + insertion + (needsSpace ? " " : "") + rest
    setText(newText)
    setSlashMenuOpen(false)
    setSlashTriggerPos(null)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        const newPos = before.length + insertion.length + (needsSpace ? 1 : 0)
        ta.setSelectionRange(newPos, newPos)
      }
    })
  }, [])

  const handleSlashPopoverSelect = useCallback((cmd: AvailableCommandInfo) => {
    const pos = cursorPosRef.current ?? textRef.current.length
    const before = textRef.current.slice(0, pos)
    const after = textRef.current.slice(pos)
    const needsSpace = pos > 0 && !/\s$/.test(before)
    const insertion = `${needsSpace ? " " : ""}/${cmd.name} `
    const newText = before + insertion + after
    setText(newText)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        const newPos = pos + insertion.length
        ta.setSelectionRange(newPos, newPos)
      }
    })
  }, [])

  const handleSkillAutocompleteSelect = useCallback(
    (skill: AgentSkillItem) => {
      // Codex uses `$<id>`, other agents use `/<id>` — matching the prefix
      // that triggered the autocomplete list.
      const pos = slashTriggerPosRef.current
      const current = textRef.current
      const triggerChar = expertPrefix.length === 1 ? expertPrefix : "$"
      const insertion = `${expertPrefix}${skill.id}`
      if (
        pos == null ||
        pos < 0 ||
        pos >= current.length ||
        current[pos] !== triggerChar
      ) {
        setText(`${insertion} `)
        setSlashMenuOpen(false)
        setSlashTriggerPos(null)
        return
      }
      const before = current.slice(0, pos)
      const afterTrigger = current.slice(pos + 1)
      const tokenMatch = afterTrigger.match(/^\S*/)
      const tokenLen = tokenMatch ? tokenMatch[0].length : 0
      const rest = afterTrigger.slice(tokenLen)
      const needsSpace = !/^\s/.test(rest)
      const newText = before + insertion + (needsSpace ? " " : "") + rest
      setText(newText)
      setSlashMenuOpen(false)
      setSlashTriggerPos(null)
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (ta) {
          ta.focus()
          const newPos = before.length + insertion.length + (needsSpace ? 1 : 0)
          ta.setSelectionRange(newPos, newPos)
        }
      })
    },
    [expertPrefix]
  )

  const handleSlashSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const total = filteredSlashCommands.length + filteredSlashSkills.length
      if (e.key === "ArrowDown") {
        e.preventDefault()
        if (total === 0) return
        setSlashSelectedIndex((i) => (i < total - 1 ? i + 1 : 0))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        if (total === 0) return
        setSlashSelectedIndex((i) => (i > 0 ? i - 1 : total - 1))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (total === 0) return
        e.preventDefault()
        if (slashSelectedIndex < filteredSlashCommands.length) {
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex])
        } else {
          const skillIndex = slashSelectedIndex - filteredSlashCommands.length
          const skill = filteredSlashSkills[skillIndex]
          if (skill) handleSkillAutocompleteSelect(skill)
        }
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setSlashMenuOpen(false)
        setSlashTriggerPos(null)
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    },
    [
      filteredSlashCommands,
      filteredSlashSkills,
      slashSelectedIndex,
      handleSlashSelect,
      handleSkillAutocompleteSelect,
    ]
  )

  // Experts always inject `prefix + expert-id ` at the very front of the
  // input, never at the cursor. The expert skill is a whole-turn directive
  // that the agent inspects first, so prepending keeps semantics unambiguous
  // regardless of what the user has already typed. If another expert prefix
  // is already at the front (from a prior click), replace it instead of
  // stacking — the agent only honors the first command, so a stacked prefix
  // would silently drop the earlier choice.
  const handleExpertPopoverSelect = useCallback(
    (expert: ExpertListItem) => {
      const current = textRef.current
      const insertion = `${expertPrefix}${expert.metadata.id} `
      const escapedPrefix = expertPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const existingPrefix = current.match(
        new RegExp(`^${escapedPrefix}([A-Za-z0-9_-]+)\\s`)
      )
      let base = current
      if (existingPrefix && expertIdSet.has(existingPrefix[1])) {
        base = current.slice(existingPrefix[0].length)
      }
      const newText = base.length === 0 ? insertion : insertion + base
      setText(newText)
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (ta) {
          ta.focus()
          // Place the caret just after the inserted prefix so the user can
          // start (or continue) typing context for the expert.
          const pos = insertion.length
          ta.setSelectionRange(pos, pos)
        }
      })
    },
    [expertIdSet, expertPrefix]
  )

  const atTriggerPosRef = useRef(atTriggerPos)
  useEffect(() => {
    atTriggerPosRef.current = atTriggerPos
  }, [atTriggerPos])

  const handleAtSelect = useCallback(
    (entry: { relativePath: string }) => {
      const pos = atTriggerPosRef.current
      if (!defaultPath || pos == null) return

      // Remove the @... token from text
      const current = textRef.current
      const beforeAt = current.slice(0, pos)
      const afterAt = current.slice(pos)
      const spaceIdx = afterAt.indexOf(" ", 1)
      const afterToken = spaceIdx === -1 ? "" : afterAt.slice(spaceIdx)
      setText(beforeAt + afterToken)

      // Attach the file
      const absPath = joinFsPath(defaultPath, entry.relativePath)
      appendResourceAttachments([absPath])

      setAtMenuOpen(false)
      setAtTriggerPos(null)

      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    [defaultPath, appendResourceAttachments]
  )

  const applyTextareaValueChange = useCallback(
    (value: string, cursorPos: number) => {
      const previousText = textRef.current
      const insertionDelta = inferInsertedTextDelta(
        previousText,
        value,
        cursorPos
      )
      if (
        insertionDelta &&
        shouldCollapsePastedText(insertionDelta.insertedText)
      ) {
        insertCollapsedPastedText(
          insertionDelta.insertedText,
          insertionDelta.selectionStart,
          insertionDelta.selectionEnd,
          previousText
        )
        return
      }

      setText(value)
      syncPastedTextsForText(value)

      const beforeCursor = value.slice(0, cursorPos)

      // Slash command detection. Allow the trigger at the very start of the
      // input or immediately after whitespace, so users can still invoke a
      // command after typing surrounding prose. Any of agent commands,
      // agent-enabled experts, or (for Codex) skills can satisfy the prompt,
      // so open the menu whenever at least one is available.
      const hasSlashSource =
        slashCommands.length > 0 ||
        availableExperts.length > 0 ||
        nonExpertSkills.length > 0
      if (hasSlashSource) {
        const slashRegex =
          agentType === "codex" ? /(^|\s)([/$])(\S*)$/ : /(^|\s)(\/)(\S*)$/
        const slashMatch = beforeCursor.match(slashRegex)
        if (slashMatch) {
          const triggerPos =
            beforeCursor.length - slashMatch[0].length + slashMatch[1].length
          setSlashTriggerPos(triggerPos)
          setSlashSelectedIndex(0)
          setSlashMenuOpen(true)
          setAtMenuOpen(false)
          return
        }
      }
      setSlashMenuOpen(false)
      setSlashTriggerPos(null)

      // @ file mention detection (at any cursor position)
      if (defaultPath) {
        const atMatch = beforeCursor.match(/(^|[\s])@([^\s]*)$/)
        if (atMatch) {
          const atPos =
            beforeCursor.length - atMatch[0].length + atMatch[1].length
          setAtTriggerPos(atPos)
          setAtSelectedIndex(0)
          setAtMenuOpen(true)
          setAtFileTreeEnabled(true)
          return
        }
      }
      setAtMenuOpen(false)
    },
    [
      slashCommands.length,
      availableExperts.length,
      nonExpertSkills.length,
      defaultPath,
      agentType,
      syncPastedTextsForText,
      insertCollapsedPastedText,
    ]
  )

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      const cursorPos = e.target.selectionStart ?? value.length
      applyTextareaValueChange(value, cursorPos)
    },
    [applyTextareaValueChange]
  )

  const handlePickFiles = useCallback(async () => {
    if (disabled) return
    try {
      const selected = await openFileDialog({
        multiple: true,
        directory: false,
        defaultPath,
      })
      if (!selected) return
      const picked = Array.isArray(selected) ? selected : [selected]
      appendResourceAttachments(picked.filter((item): item is string => !!item))
    } catch (error) {
      console.error("[MessageInput] pick files failed:", error)
    }
  }, [appendResourceAttachments, defaultPath, disabled])

  const loadQuickMessages = useCallback(async () => {
    setQuickMessagesLoading(true)
    try {
      const list = await quickMessagesList()
      setQuickMessages(list)
    } catch (error) {
      console.error("[MessageInput] load quick messages failed:", error)
    } finally {
      setQuickMessagesLoading(false)
    }
  }, [])

  const handleAddMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return
      cursorPosRef.current = textareaRef.current?.selectionStart ?? null
      loadQuickMessages().catch((error) => {
        console.error("[MessageInput] quick messages refresh failed:", error)
      })
    },
    [loadQuickMessages]
  )

  const handleQuickMessageSelect = useCallback((message: QuickMessage) => {
    const insertion = message.content
    if (!insertion) return
    const current = textRef.current
    const rawPos = cursorPosRef.current ?? current.length
    const pos = Math.max(0, Math.min(rawPos, current.length))
    const before = current.slice(0, pos)
    const after = current.slice(pos)
    setText(before + insertion + after)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      const newPos = pos + insertion.length
      ta.setSelectionRange(newPos, newPos)
    })
  }, [])

  useEffect(() => {
    if (!attachmentTabId) return

    const handleAttachFile = (event: Event) => {
      const customEvent = event as CustomEvent<AttachFileToSessionDetail>
      if (!customEvent.detail) return
      if (customEvent.detail.tabId !== attachmentTabId) return
      appendResourceAttachments([customEvent.detail.path])
    }

    window.addEventListener(ATTACH_FILE_TO_SESSION_EVENT, handleAttachFile)
    return () => {
      window.removeEventListener(ATTACH_FILE_TO_SESSION_EVENT, handleAttachFile)
    }
  }, [appendResourceAttachments, attachmentTabId])

  useEffect(() => {
    if (!attachmentTabId) return

    const handleAppendText = (event: Event) => {
      const customEvent = event as CustomEvent<AppendTextToSessionDetail>
      if (!customEvent.detail) return
      if (customEvent.detail.tabId !== attachmentTabId) return
      const appendText = customEvent.detail.text
      setText((prev) => {
        if (prev.length === 0) return appendText
        return prev.endsWith(" ") ? prev + appendText : prev + " " + appendText
      })
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    }

    window.addEventListener(APPEND_TEXT_TO_SESSION_EVENT, handleAppendText)
    return () => {
      window.removeEventListener(APPEND_TEXT_TO_SESSION_EVENT, handleAppendText)
    }
  }, [attachmentTabId])

  useEffect(() => {
    let cancelled = false
    const unlisteners: Array<() => void | Promise<void>> = []

    const cleanupListeners = () => {
      for (const fn of unlisteners.splice(0)) {
        disposeTauriListener(fn, "MessageInput.dragDrop")
      }
    }

    type DragDropPayload =
      | {
          type: "enter" | "drop"
          paths: string[]
          position: { x: number; y: number }
        }
      | {
          type: "over"
          position: { x: number; y: number }
        }
      | { type: "leave" }

    const handlePayload = (payload: DragDropPayload) => {
      const host = containerRef.current
      if (!host) return
      if (payload.type === "leave") {
        setDragActiveIfChanged(false)
        return
      }
      const inside = pointWithinElement(payload.position, host)
      if (payload.type === "drop") {
        setDragActiveIfChanged(false)
        if (Date.now() - lastDomDropAtRef.current < 250) return
        if (!inside || disabledRef.current) return
        void appendPathsFromDropRef.current(payload.paths).catch((error) => {
          console.error("[MessageInput] drag drop paths failed:", error)
        })
        return
      }
      setDragActiveIfChanged(inside && !disabledRef.current)
    }

    const setup = async () => {
      if (!isDesktop()) return
      const { getCurrentWebview } = await import("@tauri-apps/api/webview")
      const { TauriEvent } = await import("@tauri-apps/api/event")
      const webview = getCurrentWebview()
      try {
        const unlistenEnter = await webview.listen<{
          paths: string[]
          position: { x: number; y: number }
        }>(TauriEvent.DRAG_ENTER, (event) => {
          if (cancelled) return
          handlePayload({
            type: "enter",
            paths: event.payload.paths,
            position: event.payload.position,
          })
        })
        unlisteners.push(unlistenEnter)

        const unlistenOver = await webview.listen<{
          position: { x: number; y: number }
        }>(TauriEvent.DRAG_OVER, (event) => {
          if (cancelled) return
          handlePayload({
            type: "over",
            position: event.payload.position,
          })
        })
        unlisteners.push(unlistenOver)

        const unlistenDrop = await webview.listen<{
          paths: string[]
          position: { x: number; y: number }
        }>(TauriEvent.DRAG_DROP, (event) => {
          if (cancelled) return
          handlePayload({
            type: "drop",
            paths: event.payload.paths,
            position: event.payload.position,
          })
        })
        unlisteners.push(unlistenDrop)

        const unlistenLeave = await webview.listen(
          TauriEvent.DRAG_LEAVE,
          () => {
            if (cancelled) return
            handlePayload({ type: "leave" })
          }
        )
        unlisteners.push(unlistenLeave)
      } catch {
        // Ignore non-Tauri environments.
      } finally {
        if (cancelled) {
          cleanupListeners()
        }
      }
    }

    void setup()

    return () => {
      cancelled = true
      cleanupListeners()
    }
  }, [setDragActiveIfChanged])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const handleCancelQueueEditClick = useCallback(() => {
    clearPastedTexts()
    onCancelQueueEdit?.()
  }, [clearPastedTexts, onCancelQueueEdit])

  const buildDraft = useCallback((): PromptDraft | null => {
    const expandedText = expandPastedTextPlaceholders(
      textRef.current,
      pastedTextsRef.current
    )
    const trimmed = expandedText.trim()
    if (!trimmed && attachments.length === 0) return null

    const blocks: PromptInputBlock[] = []
    if (trimmed) {
      blocks.push({ type: "text", text: trimmed })
    }
    for (const attachment of attachments) {
      if (attachment.type === "resource") {
        if (attachment.kind === "link") {
          blocks.push({
            type: "resource_link",
            uri: attachment.uri,
            name: attachment.name,
            mime_type: attachment.mimeType,
            description: null,
          })
        } else {
          blocks.push({
            type: "resource",
            uri: attachment.uri,
            mime_type: attachment.mimeType,
            text: attachment.text ?? null,
            blob: attachment.blob ?? null,
          })
        }
      } else {
        blocks.push({
          type: "image",
          data: attachment.data,
          mime_type: attachment.mimeType,
          uri: attachment.uri,
        })
      }
    }

    const displayText =
      trimmed ||
      `Attached ${attachments.length} attachment${attachments.length > 1 ? "s" : ""}`
    return { blocks, displayText }
  }, [attachments])

  const handleSend = useCallback(() => {
    const draft = buildDraft()
    if (!draft) return

    // Edit mode: save back to queue item
    if (isEditingQueueItem && onSaveQueueEdit) {
      onSaveQueueEdit(draft)
      setText("")
      clearPastedTexts()
      setAttachments([])
      setInputExpanded(false)
      return
    }

    // Prompting mode: enqueue instead of sending
    if (isPrompting && onEnqueue) {
      onEnqueue(draft, showModeSelector ? effectiveModeId : null)
      setText("")
      clearPastedTexts()
      setAttachments([])
      setInputExpanded(false)
      return
    }

    onSend(draft, showModeSelector ? effectiveModeId : null)
    if (effectiveDraftStorageKey) {
      clearMessageInputDraft(effectiveDraftStorageKey)
    }
    setText("")
    clearPastedTexts()
    setAttachments([])
    setInputExpanded(false)
  }, [
    buildDraft,
    isEditingQueueItem,
    isPrompting,
    onSaveQueueEdit,
    onEnqueue,
    onSend,
    effectiveModeId,
    showModeSelector,
    effectiveDraftStorageKey,
    clearPastedTexts,
  ])

  const handleForkSendClick = useCallback(() => {
    if (!onForkSend) return
    const draft = buildDraft()
    if (!draft) return
    onForkSend(draft, showModeSelector ? effectiveModeId : null)
    if (effectiveDraftStorageKey) {
      clearMessageInputDraft(effectiveDraftStorageKey)
    }
    setText("")
    clearPastedTexts()
    setAttachments([])
    setInputExpanded(false)
  }, [
    onForkSend,
    buildDraft,
    effectiveModeId,
    showModeSelector,
    effectiveDraftStorageKey,
    clearPastedTexts,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        e.nativeEvent.isComposing ||
        composingRef.current ||
        e.key === "Process" ||
        e.keyCode === 229
      ) {
        return
      }

      if (slashMenuOpen && slashAutocompleteCount > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setSlashSelectedIndex((i) =>
            i < slashAutocompleteCount - 1 ? i + 1 : 0
          )
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setSlashSelectedIndex((i) =>
            i > 0 ? i - 1 : slashAutocompleteCount - 1
          )
          return
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault()
          // The merged list is [commands, skills].
          if (slashSelectedIndex < filteredSlashCommands.length) {
            handleSlashSelect(filteredSlashCommands[slashSelectedIndex])
          } else {
            const skillIndex = slashSelectedIndex - filteredSlashCommands.length
            const skill = filteredSlashSkills[skillIndex]
            if (skill) {
              handleSkillAutocompleteSelect(skill)
            }
          }
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          setSlashMenuOpen(false)
          setSlashTriggerPos(null)
          return
        }
      }

      if (atMenuOpen && filteredAtFiles.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setAtSelectedIndex((i) =>
            i < filteredAtFiles.length - 1 ? i + 1 : 0
          )
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setAtSelectedIndex((i) =>
            i > 0 ? i - 1 : filteredAtFiles.length - 1
          )
          return
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault()
          handleAtSelect(filteredAtFiles[atSelectedIndex])
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          setAtMenuOpen(false)
          return
        }
      }

      if (isEditingQueueItem && e.key === "Escape") {
        e.preventDefault()
        handleCancelQueueEditClick()
        return
      }

      if (matchShortcutEvent(e, shortcuts.send_message)) {
        e.preventDefault()
        if (!disabled || isPrompting || isEditingQueueItem) handleSend()
      } else if (matchShortcutEvent(e, shortcuts.newline_in_message)) {
        e.preventDefault()
        const textarea = e.currentTarget as HTMLTextAreaElement
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const value = textarea.value
        const newValue = value.substring(0, start) + "\n" + value.substring(end)
        setText(newValue)
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1
        })
      }
    },
    [
      disabled,
      isPrompting,
      isEditingQueueItem,
      handleCancelQueueEditClick,
      handleSend,
      shortcuts,
      slashMenuOpen,
      slashAutocompleteCount,
      filteredSlashCommands,
      filteredSlashSkills,
      slashSelectedIndex,
      handleSlashSelect,
      handleSkillAutocompleteSelect,
      atMenuOpen,
      filteredAtFiles,
      atSelectedIndex,
      handleAtSelect,
    ]
  )

  const handleContainerDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasDragFiles(event.dataTransfer)) return
      event.preventDefault()
      if (!disabled) {
        setDragActiveIfChanged(true)
      }
    },
    [disabled, setDragActiveIfChanged]
  )

  const handleContainerDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const related = event.relatedTarget
      if (
        related &&
        related instanceof Node &&
        event.currentTarget.contains(related)
      ) {
        return
      }
      setDragActiveIfChanged(false)
    },
    [setDragActiveIfChanged]
  )

  const handleContainerDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasDragFiles(event.dataTransfer)) return
      event.preventDefault()
      lastDomDropAtRef.current = Date.now()
      setDragActiveIfChanged(false)
      if (disabled) return
      const files = Array.from(event.dataTransfer.files ?? [])
      if (files.length > 0) {
        void appendFilesFromInput(files).catch((error) => {
          console.error("[MessageInput] drop files failed:", error)
        })
      }
    },
    [appendFilesFromInput, disabled, setDragActiveIfChanged]
  )

  const hasImageAttachments = imageAttachments.length > 0
  const hasResourceAttachments = resourceAttachments.length > 0
  const showDragActive = isDragActive && !disabled

  const selectorItems = (
    <>
      {showConfigLoading && (
        <SelectorLoadingChip label={t("loadingSettings")} />
      )}
      {hasConfigOptions &&
        availableConfigOptions.map((option) => (
          <SessionConfigSelector
            key={option.id}
            option={option}
            onSelect={(configId, value) =>
              onConfigOptionChange?.(configId, value)
            }
          />
        ))}
      {showModeLoading && <SelectorLoadingChip label={t("loadingMode")} />}
      {showModeSelector && (
        <ModeSelector
          modes={availableModes}
          selectedModeId={effectiveModeId!}
          onSelect={handleModeSelect}
          label={t("modeLabel")}
        />
      )}
    </>
  )

  const inlineSelectorItems = (
    <>
      {hasConfigOptions &&
        availableConfigOptions.map((option) => (
          <InlineSessionConfigSelector
            key={option.id}
            option={option}
            onSelect={(configId, value) =>
              onConfigOptionChange?.(configId, value)
            }
          />
        ))}
      {showModeSelector && (
        <InlineModeSelector
          modes={availableModes}
          selectedModeId={effectiveModeId!}
          onSelect={handleModeSelect}
          label={t("modeLabel")}
        />
      )}
    </>
  )

  const actionButtons = isEditingQueueItem ? (
    <div className="flex items-center gap-1">
      <Button
        onClick={handleCancelQueueEditClick}
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title={tQueue("cancelEdit")}
      >
        <X className="size-4" />
      </Button>
      <Button
        onClick={handleSend}
        disabled={!hasSendableContent}
        size="icon"
        className="h-8 w-8"
        title={tQueue("saveEdit")}
      >
        <Check className="size-4" />
      </Button>
    </div>
  ) : isPrompting && onCancel ? (
    <Button
      onClick={onCancel}
      variant="destructive"
      size="icon"
      className="h-8 w-8"
      title={t("cancel")}
    >
      <Square className="size-4" />
    </Button>
  ) : onForkSend ? (
    <div className="flex items-center">
      <Button
        onClick={handleSend}
        disabled={disabled || !hasSendableContent}
        size="icon"
        className="h-8 w-8 rounded-r-none"
        title={t("send")}
      >
        <Send className="size-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={disabled || !hasSendableContent}
            size="icon"
            className="h-8 w-5 rounded-l-none border-l border-primary-foreground/20"
            aria-label={t("forkAndSend")}
          >
            <ChevronUp className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          <DropdownMenuItem onSelect={handleForkSendClick}>
            <GitFork className="h-4 w-4" />
            {t("forkAndSend")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : (
    <Button
      onClick={handleSend}
      disabled={disabled || !hasSendableContent}
      size="icon"
      className="h-8 w-8"
      title={t("send")}
    >
      <Send className="size-4" />
    </Button>
  )

  return (
    <div
      ref={containerRef}
      className="relative"
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
    >
      {slashMenuOpen && slashAutocompleteCount > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 z-50 flex max-h-[min(16rem,40dvh)] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              role="searchbox"
              aria-label={t("slashSearchPlaceholder")}
              value={slashFilterText}
              onChange={handleSlashSearchChange}
              onKeyDown={handleSlashSearchKeyDown}
              placeholder={t("slashSearchPlaceholder")}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div ref={slashMenuListRef} className="flex-1 overflow-y-auto p-1">
            {filteredSlashCommands.map((cmd, i) => (
              <button
                key={`cmd-${cmd.name}`}
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm",
                  i === slashSelectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted"
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSlashSelect(cmd)
                }}
              >
                <span className="shrink-0 font-mono text-primary">
                  /{cmd.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {cmd.description}
                </span>
              </button>
            ))}
            {filteredSlashSkills.map((skill, i) => {
              const absoluteIndex = filteredSlashCommands.length + i
              return (
                <button
                  key={`skill-${skill.scope}-${skill.id}`}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm",
                    absoluteIndex === slashSelectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted"
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSkillAutocompleteSelect(skill)
                  }}
                >
                  <BookOpenText className="mt-0.5 size-4 shrink-0 text-primary/80" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{skill.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {expertPrefix}
                        {skill.id}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {atMenuOpen && filteredAtFiles.length > 0 && (
        <FileMentionMenu
          files={filteredAtFiles}
          selectedIndex={atSelectedIndex}
          onSelect={handleAtSelect}
        />
      )}
      <div
        className={cn(
          "@container relative flex flex-col rounded-xl border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          className,
          inputExpanded && "h-[min(70dvh,720px)] max-h-[min(70dvh,720px)]",
          showDragActive && "ring-1 ring-primary/40"
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 z-10 h-7 w-7 text-muted-foreground hover:text-foreground"
          title={inputExpanded ? t("restoreInput") : t("expandInput")}
          aria-label={inputExpanded ? t("restoreInput") : t("expandInput")}
          aria-pressed={inputExpanded}
          onClick={() => setInputExpanded((expanded) => !expanded)}
        >
          {inputExpanded ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
        </Button>
        <ConversationContextBar
          hasExtraContent={hasImageAttachments || hasResourceAttachments}
          scrollEndTrigger={attachments.length}
          hasLeadingContent={hasFolderBranchPicker}
          leadingContent={
            hasFolderBranchPicker ? (
              <ConversationFolderBranchPicker tabId={attachmentTabId} />
            ) : null
          }
          extraContent={
            <>
              {imageAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="relative shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/30"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewAttachmentId(attachment.id)}
                    className="cursor-pointer transition-opacity hover:opacity-80"
                  >
                    <Image
                      src={`data:${attachment.mimeType};base64,${attachment.data}`}
                      alt={attachment.name}
                      width={56}
                      height={56}
                      unoptimized
                      className="h-14 w-14 object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="absolute right-1 top-1 rounded-sm bg-background/70 p-0.5 hover:bg-background"
                    aria-label={t("removeAttachmentAria", {
                      name: attachment.name,
                    })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {resourceAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 text-[11px] text-muted-foreground"
                >
                  <FileSearch className="h-3 w-3" />
                  <span className="max-w-40 truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="rounded-sm p-0.5 hover:bg-muted-foreground/15"
                    aria-label={t("removeAttachmentAria", {
                      name: attachment.name,
                    })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </>
          }
        />
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={() => (composingRef.current = false)}
          onPaste={handlePaste}
          onFocus={onFocus}
          placeholder={resolvedPlaceholder}
          className="min-h-0 flex-1 overflow-y-auto rounded-none border-0 bg-transparent pr-10 text-base shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-sm"
          autoFocus={autoFocus}
        />
        <div className="flex shrink-0 items-end justify-between gap-1 px-2 pb-2">
          <div className="flex min-w-0 items-end gap-1">
            <DropdownMenu onOpenChange={handleAddMenuOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={disabled}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  title={t("addActions")}
                  aria-label={t("addActions")}
                >
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="min-w-48"
              >
                <DropdownMenuItem
                  onClick={() => {
                    handlePickFiles().catch((error) => {
                      console.error(
                        "[MessageInput] pick files from menu failed:",
                        error
                      )
                    })
                  }}
                >
                  <Paperclip className="size-4" />
                  {t("attachFiles")}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <MessageSquareText className="size-4" />
                    {t("quickMessages")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className="min-w-40 overflow-y-auto"
                    style={{
                      maxWidth: "min(20rem, calc(100vw - 1rem))",
                      maxHeight:
                        "min(32rem, var(--radix-dropdown-menu-content-available-height))",
                    }}
                  >
                    {quickMessagesLoading && quickMessages.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                        {t("quickMessagesLoading")}
                      </div>
                    ) : quickMessages.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                        {t("quickMessagesEmpty")}
                      </div>
                    ) : (
                      quickMessages.map((message) => (
                        <DropdownMenuItem
                          key={message.id}
                          onClick={() => handleQuickMessageSelect(message)}
                        >
                          <span className="truncate">
                            {message.title || (
                              <span className="italic text-muted-foreground">
                                {t("quickMessageUntitled")}
                              </span>
                            )}
                          </span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sparkles className="size-4" />
                    {t("expertSkills")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className="min-w-72 overflow-y-auto"
                    style={{
                      maxWidth: "min(20rem, calc(100vw - 1rem))",
                      maxHeight:
                        "min(32rem, var(--radix-dropdown-menu-content-available-height))",
                    }}
                  >
                    {availableExperts.length === 0 ? (
                      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                        {t("expertsEmptyForAgent")}
                      </div>
                    ) : (
                      groupedExperts.map(([category, items], groupIndex) => (
                        <div key={category}>
                          {groupIndex > 0 && <DropdownMenuSeparator />}
                          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide">
                            {translateExpertCategory(category)}
                          </DropdownMenuLabel>
                          {items.map((expert) => {
                            const Icon = getExpertIcon(expert.metadata.icon)
                            const name =
                              pickExpertLocalized(
                                expert.metadata.display_name,
                                locale
                              ) || expert.metadata.id
                            const description = pickExpertLocalized(
                              expert.metadata.description,
                              locale
                            )
                            return (
                              <DropdownMenuItem
                                key={expert.metadata.id}
                                onClick={() =>
                                  handleExpertPopoverSelect(expert)
                                }
                                className="items-start gap-2"
                              >
                                <Icon className="mt-0.5 size-4 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium">
                                    {name}
                                  </div>
                                  {description && (
                                    <div className="line-clamp-2 text-xs text-muted-foreground">
                                      {description}
                                    </div>
                                  )}
                                </div>
                              </DropdownMenuItem>
                            )
                          })}
                        </div>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub
                  open={slashDropdownOpen}
                  onOpenChange={handleSlashDropdownOpenChange}
                >
                  <DropdownMenuSubTrigger
                    disabled={slashCommands.length === 0}
                    onPointerDown={() => {
                      cursorPosRef.current =
                        textareaRef.current?.selectionStart ?? null
                    }}
                  >
                    <Command className="size-4" />
                    {t("slashCommands")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className="flex min-w-72 flex-col overflow-hidden p-0"
                    style={{
                      maxWidth: "min(20rem, calc(100vw - 1rem))",
                      maxHeight:
                        "min(32rem, var(--radix-dropdown-menu-content-available-height))",
                    }}
                  >
                    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
                      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <input
                        ref={slashDropdownInputRef}
                        type="text"
                        role="searchbox"
                        aria-label={t("slashSearchPlaceholder")}
                        value={slashDropdownSearch}
                        onChange={(e) => setSlashDropdownSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowDown") {
                            e.preventDefault()
                            const container = e.currentTarget.closest(
                              '[data-slot="dropdown-menu-sub-content"]'
                            )
                            const firstItem =
                              container?.querySelector<HTMLElement>(
                                '[role="menuitem"]'
                              )
                            firstItem?.focus()
                            return
                          }
                          if (e.key === "Enter") {
                            e.preventDefault()
                            const first = filteredSlashDropdownCommands[0]
                            if (first) {
                              handleSlashPopoverSelect(first)
                              setSlashDropdownOpen(false)
                            }
                            return
                          }
                          if (e.key === "Escape" || e.key === "Tab") return
                          // Prevent radix DropdownMenu's built-in typeahead
                          // from hijacking letter keys while the user is
                          // typing.
                          e.stopPropagation()
                        }}
                        placeholder={t("slashSearchPlaceholder")}
                        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto p-1">
                      {filteredSlashDropdownCommands.length === 0 ? (
                        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                          {t("slashSearchEmpty")}
                        </div>
                      ) : (
                        filteredSlashDropdownCommands.map((cmd) => (
                          <DropdownMenuItem
                            key={cmd.name}
                            onClick={() => handleSlashPopoverSelect(cmd)}
                            // Radix focuses the item on pointermove, which
                            // fires while scrolling (items slide under the
                            // cursor) and steals focus from the search input.
                            // Short-circuit that default with preventDefault
                            // so the search keeps focus until the user
                            // explicitly clicks.
                            onPointerMove={(e) => e.preventDefault()}
                            onPointerLeave={(e) => e.preventDefault()}
                            className="hover:bg-accent hover:text-accent-foreground"
                          >
                            <DropdownRadioItemContent
                              label={`/${cmd.name}`}
                              description={cmd.description}
                            />
                          </DropdownMenuItem>
                        ))
                      )}
                    </div>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            {hasInlineSelectors && (
              <div className="hidden min-w-0 items-end gap-1 @[34rem]:flex">
                {inlineSelectorItems}
              </div>
            )}
            {hasAnySelector && (
              <div
                className={cn("flex", hasInlineSelectors && "@[34rem]:hidden")}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title={t("agentSettings")}
                      aria-label={t("agentSettings")}
                    >
                      {agentType ? (
                        <AgentIcon agentType={agentType} className="size-4" />
                      ) : (
                        <Cog className="size-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="start"
                    className="min-w-56"
                  >
                    {selectorItems}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
          <div className="shrink-0">{actionButtons}</div>
        </div>
      </div>
      {showDragActive && (
        <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-md border border-dashed border-primary/50 bg-background/80 text-xs text-muted-foreground">
          {t("dropFilesToAttach")}
        </div>
      )}
      <ImagePreviewDialog
        src={
          previewAttachment
            ? `data:${previewAttachment.mimeType};base64,${previewAttachment.data}`
            : ""
        }
        alt={previewAttachment?.name ?? ""}
        open={previewAttachment !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachmentId(null)
        }}
      />
    </div>
  )
}
