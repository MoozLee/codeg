import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Write text to the clipboard. Falls back to a hidden textarea +
 * `document.execCommand("copy")` when the async Clipboard API is unavailable
 * (non-secure contexts such as HTTP over LAN).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to legacy path
    }
  }
  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.setAttribute("aria-hidden", "true")
    textarea.style.position = "absolute"
    textarea.style.left = "-9999px"
    textarea.style.top = `${window.pageYOffset || document.documentElement.scrollTop}px`
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    const selectionApi = document.getSelection()
    const previousRange =
      selectionApi && selectionApi.rangeCount > 0
        ? selectionApi.getRangeAt(0).cloneRange()
        : null
    document.body.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    let ok = false
    try {
      ok = document.execCommand("copy")
    } catch {
      ok = false
    }
    textarea.remove()
    if (previousRange) {
      try {
        const selection = document.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(previousRange)
      } catch {
        // restoring the prior page selection is best-effort
      }
    }
    return ok
  } catch {
    return false
  }
}

/**
 * Generate a UUID v4. Uses `crypto.randomUUID()` when available (secure
 * contexts), otherwise falls back to `crypto.getRandomValues()`.
 */
export function randomUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID()
  }
  // Fallback for non-secure contexts (HTTP over LAN)
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Set version 4 and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
