import { mergeAttributes, Node } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"

import type { PastedTextAttrs } from "../types"
import { PastedTextView } from "./pasted-text-view"

const NODE_NAME = "pastedText"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pastedText: {
      /** Insert a collapsed inline atom that serializes to the full pasted text. */
      insertPastedText: (content: string) => ReturnType
    }
  }
}

/**
 * Inline atom for a large plain-text paste. The node view renders a compact badge,
 * while the attribute keeps the complete text for send/copy/draft serialization.
 * HTML clipboard output carries the original text as the span's text content, so
 * copying the atom never leaks an internal placeholder.
 */
export const PastedText = Node.create({
  name: NODE_NAME,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element) => element.textContent ?? "",
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-pasted-text]" }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-pasted-text": "" }),
      (node.attrs as PastedTextAttrs).content,
    ]
  },

  renderText({ node }) {
    return (node.attrs as PastedTextAttrs).content
  },

  addNodeView() {
    return ReactNodeViewRenderer(PastedTextView)
  },

  addCommands() {
    return {
      insertPastedText:
        (content: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: NODE_NAME,
            attrs: { content } satisfies PastedTextAttrs,
          }),
    }
  },
})
