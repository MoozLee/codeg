import { ClipboardPaste } from "lucide-react"
import { useTranslations } from "next-intl"
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react"

import type { PastedTextAttrs } from "../types"

export function PastedTextView({ node }: ReactNodeViewProps) {
  const t = useTranslations("Folder.chat.messageInput")
  const { content } = node.attrs as PastedTextAttrs
  const lineCount = (content.match(/\n/g) ?? []).length + 1
  const detail =
    lineCount > 1
      ? t("pastedTextLines", { count: lineCount })
      : t("pastedTextCharacters", { count: content.length })

  return (
    <NodeViewWrapper
      as="span"
      className="codeg-pasted-text"
      contentEditable={false}
    >
      <span
        data-pasted-text-badge
        className="inline-flex max-w-full items-center gap-1 rounded-[0.25rem] border border-border bg-muted/70 px-1.5 py-0.5 align-middle text-xs text-muted-foreground"
        title={`${t("pastedText")}: ${detail}`}
        aria-label={`${t("pastedText")}: ${detail}`}
      >
        <ClipboardPaste className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{t("pastedText")}</span>
        <span className="shrink-0 text-muted-foreground/75">{detail}</span>
      </span>
    </NodeViewWrapper>
  )
}
