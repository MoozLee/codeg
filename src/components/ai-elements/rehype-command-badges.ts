// User messages send slash commands / Codex skills / experts as bare invocation
// tokens (`/review`, `$deploy`, `/code-reviewer`) — the agent CLI needs them
// literal, so there is no link to key a badge off. This rehype plugin restores
// the badge *for display* by scanning text nodes for `/slug` / `$slug` tokens and
// wrapping each in a `codeg://skill/<slug>` link, which MarkdownLink renders as a
// ReferenceBadge. It is intentionally a HEURISTIC (the token is indistinguishable
// from typed text), so it skips the obvious false positives: file-ish paths
// (`/a/b`), code, math, and existing links.
//
// Why rehype (not remark): Streamdown appends its math remark plugin AFTER the
// host's remark plugins, so at the remark stage `$x$` is still raw text and a
// `$slug` scan would corrupt math. Its rehype plugins run BEFORE the math
// (katex) rehype plugin, and by then remark-math has usually turned `$x$` into a
// `.math` element with the `$` delimiters stripped. The math plugin is lazily
// loaded, though, so the first render can still contain raw `$...$` text; this
// plugin skips both `.math` elements and probable raw dollar-math ranges.
//
// Apply only to user messages (the host gates on `softBreaks`); an assistant's
// `/path` or `$var` in prose must not be badged.

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown; [key: string]: unknown }
  children?: HastNode[]
}

// `/` commands & most skills, `$` Codex skills/experts. The slug starts with a
// letter (so `/123` / `$5` aren't matched) and the boundary before it must be
// start-of-text or whitespace. A trailing `/` (a path like `/usr/bin`) disqualifies
// it. `\w`/`-` in the lookahead are already excluded by the greedy slug; `/` is
// the meaningful guard.
const TOKEN_RE = /(^|\s)([/$][A-Za-z][A-Za-z0-9_-]*)(?![/$\w-])/g

/** Elements whose text must NOT be scanned: code, existing links, and math. */
function isSkipElement(node: HastNode): boolean {
  if (node.type !== "element") return false
  if (
    node.tagName === "code" ||
    node.tagName === "pre" ||
    node.tagName === "a"
  ) {
    return true
  }
  const cls = node.properties?.className
  const list = Array.isArray(cls)
    ? cls
    : typeof cls === "string"
      ? cls.split(/\s+/)
      : []
  return list.some(
    (c) =>
      typeof c === "string" &&
      (c === "math" || c.startsWith("math-") || c.startsWith("katex"))
  )
}

/** A `codeg://skill/<slug>` link whose text keeps the literal `/`·`$` prefix. */
function badgeAnchor(token: string): HastNode {
  const slug = token.slice(1)
  return {
    type: "element",
    tagName: "a",
    properties: { href: `codeg://skill/${encodeURIComponent(slug)}` },
    children: [{ type: "text", value: token }],
  }
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
 * Split a text value into `[text, anchor, text, …]`, or null when it has no
 * invocation token (so the caller can keep the original node untouched).
 */
function tokenize(value: string): HastNode[] | null {
  TOKEN_RE.lastIndex = 0
  const mathRanges = collectDollarMathRanges(value)
  let match: RegExpExecArray | null
  let lastIndex = 0
  let out: HastNode[] | null = null
  while ((match = TOKEN_RE.exec(value)) !== null) {
    const token = match[2]
    const tokenStart = match.index + match[1].length
    if (isInsideRange(tokenStart, mathRanges)) continue
    out ??= []
    if (tokenStart > lastIndex) {
      out.push({ type: "text", value: value.slice(lastIndex, tokenStart) })
    }
    out.push(badgeAnchor(token))
    lastIndex = TOKEN_RE.lastIndex
  }
  if (out && lastIndex < value.length) {
    out.push({ type: "text", value: value.slice(lastIndex) })
  }
  return out
}

function transform(node: HastNode, skip: boolean): void {
  if (!Array.isArray(node.children)) return
  const childrenSkip = skip || isSkipElement(node)
  const next: HastNode[] = []
  for (const child of node.children) {
    if (child.type === "text" && !childrenSkip) {
      const tokens =
        typeof child.value === "string" ? tokenize(child.value) : null
      if (tokens) next.push(...tokens)
      else next.push(child)
    } else {
      if (child.type === "element") transform(child, childrenSkip)
      next.push(child)
    }
  }
  node.children = next
}

/** Rehype plugin: badge `/slug` / `$slug` tokens (user messages only). */
export function rehypeCommandBadges() {
  return (tree: HastNode) => {
    transform(tree, false)
  }
}
