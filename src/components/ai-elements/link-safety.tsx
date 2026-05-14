"use client"

import type { ReactNode } from "react"
import { useCallback, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { openUrl } from "@/lib/platform"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

function LinkSafetyModal({
  url,
  isOpen,
  onClose,
  onAction,
}: LinkSafetyModalProps & {
  onAction: (url: string) => Promise<void>
}) {
  const t = useTranslations("Folder.chat.linkSafety")
  const [opening, setOpening] = useState(false)
  const localTarget = useMemo(() => parseLocalFileTarget(url), [url])
  const isLocalFile = Boolean(localTarget)

  const handleAction = useCallback(() => {
    if (opening) return
    setOpening(true)
    void onAction(url).finally(() => {
      setOpening(false)
    })
  }, [onAction, opening, url])

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isLocalFile ? t("localFileTitle") : t("externalLinkTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isLocalFile
              ? t("localFileDescription")
              : t("externalLinkDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-28 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
          {localTarget?.path ?? url}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={opening}>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction disabled={opening} onClick={handleAction}>
            {opening
              ? t("opening")
              : isLocalFile
                ? t("openFile")
                : t("openLink")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
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

      try {
        await openUrl(url)
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

  const renderModal = useCallback(
    (props: LinkSafetyModalProps) => (
      <LinkSafetyModal {...props} onAction={handleOpenTarget} />
    ),
    [handleOpenTarget]
  )

  return useMemo(
    () => ({
      enabled: true,
      renderModal,
    }),
    [renderModal]
  )
}

/**
 * Clickable file-path label that opens the same "open local file" confirmation
 * dialog used for markdown links inside agent messages, then routes the file
 * into the workspace file panel.
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

  const [isOpen, setIsOpen] = useState(false)
  const [opening, setOpening] = useState(false)

  const handleConfirm = useCallback(() => {
    if (opening) return
    if (!folderPath) {
      toast.error(t("errorCannotOpen"), {
        description: t("errorNoWorkspace"),
      })
      setIsOpen(false)
      return
    }
    const relativePath = resolveToolFilePath(filePath, folderPath)
    if (!relativePath) {
      toast.error(t("errorCannotOpen"), {
        description: t("errorOutsideWorkspace"),
      })
      setIsOpen(false)
      return
    }

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
        setOpening(false)
        setIsOpen(false)
      })
  }, [filePath, folderPath, line, opening, openFilePreview, t])

  return (
    <>
      <span className={cn("block min-w-0", className)}>
        <button
          type="button"
          title={title ?? filePath}
          className="max-w-full cursor-pointer truncate text-left align-bottom hover:underline focus-visible:underline focus-visible:outline-none"
          onClick={(e) => {
            e.stopPropagation()
            setIsOpen(true)
          }}
        >
          {children}
        </button>
      </span>
      <AlertDialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!next && !opening) setIsOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("localFileTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("localFileDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-28 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
            {filePath}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={opening}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction disabled={opening} onClick={handleConfirm}>
              {opening ? t("opening") : t("openFile")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
