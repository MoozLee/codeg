import { parseCodegReferenceUri } from "@/components/chat/composer/reference-uri"
import type { ReferenceAttrs } from "@/components/chat/composer/types"
import { INVOCATION_TOKEN_RE } from "@/lib/invocation-token"
import {
  tokenizeReferenceLinks,
  unescapeReferenceLabel,
} from "@/lib/reference-link"

/**
 * One render unit of a user message: a run of literal prose, or a resolved
 * reference to show as an inline badge.
 */
export type UserMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "reference"; attrs: ReferenceAttrs }

/**
 * Only these schemes become badges. A `[label](https://…)` a user typed is NOT a
 * reference — it stays literal text (the composer is plain-text; genuine badges
 * are always inserted via the `@`·`/`·`$` menus and serialize to `file:`/`codeg:`).
 */
const REFERENCE_SCHEME = /^(?:file:|codeg:)/i

/** Strip a CommonMark angle-bracket destination (`<uri>`) to the bare uri, so the
 *  scheme test and `parseCodegReferenceUri` see a clean value (mirrors the reload
 *  adapter's unwrap in `ai-elements-adapter.handleMarkdownLink`). */
function unwrapDestination(destination: string): string {
  const trimmed = destination.trim()
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1).trim()
    : trimmed
}

type Range = readonly [start: number, end: number]

const MATH_CUE_RE = /[\\^_=+*<>|()[\]{}-]|\d/
const SHORT_SYMBOL_RE = /^[A-Za-z]{1,3}$/

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 1
}

function findClosingDollar(
  value: string,
  start: number,
  delimiterLength: 1 | 2
): number {
  const delimiter = delimiterLength === 2 ? "$$" : "$"
  for (let i = start; i <= value.length - delimiterLength; i += 1) {
    if (value.slice(i, i + delimiterLength) !== delimiter) continue
    if (isEscaped(value, i)) continue
    if (delimiterLength === 1 && value[i + 1] === "$") continue
    return i
  }
  return -1
}

function isProbablyMathContent(
  content: string,
  delimiterLength: 1 | 2
): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  if (delimiterLength === 2) return true
  if (trimmed.includes("\n")) return false
  if (SHORT_SYMBOL_RE.test(trimmed)) return true
  return MATH_CUE_RE.test(trimmed)
}

function collectDollarMathRanges(value: string): Range[] {
  const ranges: Range[] = []
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "$" || isEscaped(value, i)) continue
    const delimiterLength: 1 | 2 = value[i + 1] === "$" ? 2 : 1
    if (delimiterLength === 1 && /\s/.test(value[i + 1] ?? "")) continue

    const closing = findClosingDollar(
      value,
      i + delimiterLength,
      delimiterLength
    )
    if (closing === -1) continue
    const content = value.slice(i + delimiterLength, closing)
    // `$run $fix` is two adjacent invocation tokens, not inline math whose
    // closing delimiter happens to open the next token. A closing single `$`
    // immediately followed by a slug character is therefore left to the shared
    // invocation tokenizer when the enclosed text is itself a valid slug.
    const overlapsNextInvocation =
      delimiterLength === 1 &&
      /^[A-Za-z0-9_-]+\s*$/.test(content) &&
      /[A-Za-z0-9_-]/.test(value[closing + 1] ?? "")
    if (overlapsNextInvocation) continue
    if (!isProbablyMathContent(content, delimiterLength)) continue

    ranges.push([i, closing + delimiterLength])
    i = closing + delimiterLength - 1
  }
  return ranges
}

function isInsideRange(index: number, ranges: Range[]): boolean {
  return ranges.some(([start, end]) => index >= start && index < end)
}

/**
 * Split a plain-prose run into literal text and bare `/slug`·`$slug` skill
 * badges (same {@link INVOCATION_TOKEN_RE} the composer's triggers use). Probable
 * `$...$` / `$$...$$` math ranges remain literal, while recognized invocation
 * badges drop the prefix to match the composer's inline badge.
 */
function pushProseSegments(value: string, out: UserMessageSegment[]): void {
  INVOCATION_TOKEN_RE.lastIndex = 0
  const mathRanges = collectDollarMathRanges(value)
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INVOCATION_TOKEN_RE.exec(value)) !== null) {
    const token = match[2]
    const tokenStart = match.index + match[1].length
    if (isInsideRange(tokenStart, mathRanges)) continue
    if (tokenStart > lastIndex) {
      out.push({ kind: "text", text: value.slice(lastIndex, tokenStart) })
    }
    const slug = token.slice(1)
    // Resolve through the shared reference parser, which strips the leading
    // `/`·`$` so the badge label is the bare slug (`build`, `deploy`) — matching
    // the composer's inline command/skill badge.
    const attrs = parseCodegReferenceUri(
      `codeg://skill/${encodeURIComponent(slug)}`,
      token
    )
    out.push(
      attrs ? { kind: "reference", attrs } : { kind: "text", text: token }
    )
    lastIndex = INVOCATION_TOKEN_RE.lastIndex
  }
  if (lastIndex < value.length) {
    out.push({ kind: "text", text: value.slice(lastIndex) })
  }
}

/**
 * Parse a sent user-message text string into ordered render segments: literal
 * prose (line breaks preserved by the renderer) interleaved with the five
 * built-in reference badges. Pure — no React, so it round-trips against
 * {@link "@/components/chat/composer/reference-text".referenceToMarkdown} in tests.
 *
 * Two passes over the shared wire format (unchanged by this feature):
 *  1. {@link tokenizeReferenceLinks} splits `[label](dest)` links from prose. A
 *     link whose (angle-unwrapped) destination is a `file:`/`codeg:` reference
 *     becomes a badge via {@link parseCodegReferenceUri}; any other link stays
 *     literal (rendered as its raw `[label](dest)` source).
 *  2. The prose between links is scanned for bare `/slug`·`$slug` skill tokens.
 *
 * Deliberately NOT Markdown: headings/bold/lists/code/tables in the text stay
 * literal, matching the plain-text composer.
 */
export function parseUserMessageSegments(text: string): UserMessageSegment[] {
  const out: UserMessageSegment[] = []
  for (const token of tokenizeReferenceLinks(text)) {
    if (token.type === "link") {
      const destination = unwrapDestination(token.destination)
      if (REFERENCE_SCHEME.test(destination)) {
        const attrs = parseCodegReferenceUri(
          destination,
          unescapeReferenceLabel(token.label)
        )
        if (attrs) {
          out.push({ kind: "reference", attrs })
          continue
        }
      }
      // Not a recognized reference link: keep its raw source verbatim.
      out.push({ kind: "text", text: token.raw })
      continue
    }
    pushProseSegments(token.value, out)
  }
  return out
}
