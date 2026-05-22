"use client"

import type { ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { openUrl } from "@/lib/platform"
import { getActiveRemoteConnectionId, isDesktop } from "@/lib/transport"
import { toErrorMessage } from "@/lib/app-error"
import type { LinkSafetyConfig, LinkSafetyModalProps } from "streamdown"
import { toast } from "sonner"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { cn } from "@/lib/utils"
import {
  parseLocalFileTarget,
  resolveToolFilePath,
  toWorkspaceRelativePath,
} from "@/lib/local-file-target"

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/
const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
])
// Protocols handled by the OS (mail client, dialer) rather than a browser
// page load. They must NOT be opened via `window.open(_, "_blank")` — most
// browsers leave behind an empty `about:blank` tab once the OS handler fires.
const OS_HANDLER_PROTOCOLS = new Set(["mailto:", "tel:"])

function parseExternalUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  if (trimmed.startsWith("//")) {
    try {
      return new URL(trimmed, window.location.href)
    } catch {
      return null
    }
  }

  if (!URL_SCHEME.test(trimmed) || WINDOWS_ABSOLUTE_PATH.test(trimmed)) {
    return null
  }

  try {
    return new URL(trimmed)
  } catch {
    return null
  }
}

function getAllowedExternalProtocol(rawUrl: string): string | null {
  const parsed = parseExternalUrl(rawUrl)
  if (!parsed) return null
  const protocol = parsed.protocol.toLowerCase()
  return ALLOWED_EXTERNAL_PROTOCOLS.has(protocol) ? protocol : null
}

/**
 * True when the current window has no access to the Tauri opener plugin
 * (pure web, or a Tauri window bound to a remote codeg-server).
 */
function isWebOpenerEnvironment(): boolean {
  return !isDesktop() || getActiveRemoteConnectionId() !== null
}

function shouldLetStreamdownOpenExternalUrl(rawUrl: string): boolean {
  if (parseLocalFileTarget(rawUrl)) return false
  const protocol = getAllowedExternalProtocol(rawUrl)
  if (!protocol) return false
  // OS-handler protocols always go through our own path so we can dispatch
  // them via a synthetic anchor click — streamdown's `window.open(_, "_blank")`
  // would otherwise leave a blank tab behind.
  if (OS_HANDLER_PROTOCOLS.has(protocol)) return false
  return isWebOpenerEnvironment()
}

/**
 * Trigger an OS-registered protocol handler (mail client, dialer) from a
 * browser without leaving an empty tab. The synthetic anchor has no
 * `target`, so the browser hands the URL to the OS handler and stays on
 * the current page.
 */
function dispatchOsHandlerUrl(url: string): void {
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.rel = "noreferrer noopener"
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
  }
}

/**
 * Streamdown's link-safety contract renders this component whenever
 * `onLinkCheck` declines a click. We render nothing — instead we hijack
 * the `isOpen` transition to run our open-target action immediately, then
 * call `onClose()` so streamdown's internal `isOpen` flag flips back to
 * `false` and the next click on the same link is accepted.
 *
 * The handler identities are pinned through refs so a parent re-render
 * mid-flight (translator function, workspace context, etc.) cannot tear
 * down the effect and leave streamdown stuck with `isOpen === true`.
 */
function DirectLinkOpen({
  url,
  isOpen,
  onClose,
  onAction,
}: LinkSafetyModalProps & {
  onAction: (url: string) => Promise<void>
}) {
  const lastOpenedUrlRef = useRef<string | null>(null)
  const onActionRef = useRef(onAction)
  const onCloseRef = useRef(onClose)

  // Sync the latest handler identities into refs after each render so the
  // trigger effect below can stay scoped to `[isOpen, url]` and survive
  // mid-flight parent re-renders.
  useEffect(() => {
    onActionRef.current = onAction
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!isOpen) {
      lastOpenedUrlRef.current = null
      return
    }
    if (lastOpenedUrlRef.current === url) return
    lastOpenedUrlRef.current = url
    void onActionRef.current(url).finally(() => {
      onCloseRef.current()
    })
  }, [isOpen, url])

  return null
}

function useOpenLinkOrFile() {
  const t = useTranslations("Folder.chat.linkSafety")
  const { activeFolder: folder } = useActiveFolder()
  const folderPath = folder?.path
  const { openFilePreview } = useWorkspaceContext()

  return useCallback(
    async (url: string) => {
      const localTarget = parseLocalFileTarget(url)
      if (localTarget) {
        if (!folderPath) {
          toast.error(t("errorCannotOpen"), {
            description: t("errorNoWorkspace"),
          })
          return
        }

        const relativePath = toWorkspaceRelativePath(
          localTarget.path,
          folderPath
        )
        if (!relativePath) {
          toast.error(t("errorCannotOpen"), {
            description: t("errorOutsideWorkspace"),
          })
          return
        }

        try {
          await openFilePreview(relativePath, {
            line: localTarget.line ?? undefined,
          })
        } catch (error) {
          toast.error(t("errorFailedOpen"), {
            description: toErrorMessage(error),
          })
        }
        return
      }

      const protocol = getAllowedExternalProtocol(url)
      if (!protocol) {
        toast.error(t("errorFailedLink"), {
          description: t("errorUnsupportedLinkProtocol"),
        })
        return
      }

      try {
        if (OS_HANDLER_PROTOCOLS.has(protocol) && isWebOpenerEnvironment()) {
          dispatchOsHandlerUrl(url)
        } else {
          await openUrl(url)
        }
      } catch (error) {
        toast.error(t("errorFailedLink"), {
          description: toErrorMessage(error),
        })
      }
    },
    [folderPath, openFilePreview, t]
  )
}

export function useStreamdownLinkSafety(): LinkSafetyConfig {
  const handleOpenTarget = useOpenLinkOrFile()

  const handleLinkCheck = useCallback(
    (url: string) => shouldLetStreamdownOpenExternalUrl(url),
    []
  )

  const renderModal = useCallback(
    (props: LinkSafetyModalProps) => (
      <DirectLinkOpen {...props} onAction={handleOpenTarget} />
    ),
    [handleOpenTarget]
  )

  return useMemo(
    () => ({
      enabled: true,
      onLinkCheck: handleLinkCheck,
      renderModal,
    }),
    [handleLinkCheck, renderModal]
  )
}

/**
 * Clickable file-path label that opens the same "open local file" path used for
 * markdown links inside agent messages, then routes the file into the workspace
 * file panel.
 */
export function FilePathLink({
  filePath,
  line,
  className,
  title,
  children,
}: {
  filePath: string
  line?: number | null
  className?: string
  title?: string
  children: ReactNode
}) {
  const t = useTranslations("Folder.chat.linkSafety")
  const { activeFolder: folder } = useActiveFolder()
  const folderPath = folder?.path ?? null
  const { openFilePreview } = useWorkspaceContext()
  // `opening` drives the visual busy state. `openingRef` is the synchronous
  // gate that survives rapid double-fires within a single event tick —
  // React batches the `setOpening(true)` commit, so relying purely on the
  // `disabled` attribute would leave a window where two clicks dispatched
  // before commit could both pass the early-return check.
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)

  const handleOpen = useCallback(() => {
    if (openingRef.current) return
    if (!folderPath) {
      toast.error(t("errorCannotOpen"), {
        description: t("errorNoWorkspace"),
      })
      return
    }
    const relativePath = resolveToolFilePath(filePath, folderPath)
    if (!relativePath) {
      toast.error(t("errorCannotOpen"), {
        description: t("errorOutsideWorkspace"),
      })
      return
    }

    openingRef.current = true
    setOpening(true)
    void openFilePreview(relativePath, {
      line: line ?? undefined,
    })
      .catch((error) => {
        toast.error(t("errorFailedOpen"), {
          description: toErrorMessage(error),
        })
      })
      .finally(() => {
        openingRef.current = false
        setOpening(false)
      })
  }, [filePath, folderPath, line, openFilePreview, t])

  return (
    <span className={cn("block min-w-0", className)}>
      <button
        type="button"
        title={title ?? filePath}
        aria-busy={opening}
        disabled={opening}
        className="max-w-full cursor-pointer truncate text-left align-bottom hover:underline focus-visible:underline focus-visible:outline-none disabled:cursor-wait disabled:opacity-70 disabled:hover:no-underline"
        onClick={(e) => {
          e.stopPropagation()
          handleOpen()
        }}
      >
        {children}
      </button>
    </span>
  )
}
