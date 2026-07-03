export interface LocalFileTarget {
  path: string
  line: number | null
}

export interface WorkspaceFileTarget {
  relativePath: string
  line: number | null
}

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/
const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
const FILE_EXTENSION =
  /(?:^|\/)[^/]+\.[A-Za-z0-9][A-Za-z0-9_-]*(?::\d+(?::\d+)?)?$/
const LINE_SUFFIX = /:\d+(?::\d+)?$/
const SELECTED_PATH_CANDIDATE =
  /(?:file:\/\/[^\s<>"'`)}\]]+|(?:[a-zA-Z]:[\\/]|\/|\.{1,2}[\\/]|~[\\/])?[^\s<>"'`)}\]]+(?:[\\/][^\s<>"'`)}\]]+)*)/g

export function normalizeSlashPath(path: string): string {
  return path.replace(/\\/g, "/")
}

/** Strip leading slash before Windows drive letter: /C:/foo → C:/foo */
function stripLeadingSlashOnWindows(p: string): string {
  if (p.startsWith("/") && WINDOWS_ABSOLUTE_PATH.test(p.slice(1))) {
    return p.slice(1)
  }
  return p
}

function decodeUriSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseLineValue(raw: string | undefined): number | null {
  if (!raw) return null
  const line = Number.parseInt(raw, 10)
  if (!Number.isFinite(line) || line <= 0) return null
  return line
}

function parseHashLine(hash: string): number | null {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash
  if (!normalized) return null
  return (
    parseLineValue(normalized.match(/^L(\d+)(?:-L?\d+)?$/i)?.[1]) ??
    parseLineValue(normalized.match(/^line=(\d+)$/i)?.[1]) ??
    parseLineValue(normalized.match(/^(\d+)$/)?.[1])
  )
}

function splitPathAndLine(rawPath: string): LocalFileTarget {
  const trimmed = rawPath.trim()
  const match = trimmed.match(/^(.*):(\d+)(?::\d+)?$/)
  if (!match) {
    return { path: trimmed, line: null }
  }

  const maybePath = match[1]
  if (!maybePath || maybePath.endsWith("://")) {
    return { path: trimmed, line: null }
  }

  const line = parseLineValue(match[2])
  if (!line) {
    return { path: trimmed, line: null }
  }

  return { path: maybePath, line }
}

function isLocalPathLike(path: string): boolean {
  // "//host/..." (forward slashes) is protocol-relative: a web URL, not a
  // local path. A "\\server\share" path is a local UNC path and must route to
  // the file opener after slash normalization.
  return (
    (path.startsWith("/") && !path.startsWith("//")) ||
    path.startsWith("\\\\") ||
    path.startsWith("./") ||
    path.startsWith("../") ||
    path.startsWith("~/") ||
    WINDOWS_ABSOLUTE_PATH.test(path)
  )
}

export function parseLocalFileTarget(rawUrl: string): LocalFileTarget | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  if (trimmed.toLowerCase().startsWith("file://")) {
    try {
      const parsed = new URL(trimmed)
      const rawPathname = decodeUriSafely(parsed.pathname)
      // A non-empty host is a UNC authority (file://server/share/x) — preserve
      // it as //server/share/x rather than collapsing to local /share/x.
      const normalizedPathname = parsed.host
        ? `//${parsed.host}${rawPathname}`
        : stripLeadingSlashOnWindows(rawPathname)
      const pathAndLine = splitPathAndLine(normalizedPathname)
      if (!pathAndLine.path) return null
      return {
        path: normalizeSlashPath(pathAndLine.path),
        line: parseHashLine(parsed.hash) ?? pathAndLine.line,
      }
    } catch {
      return null
    }
  }

  if (URL_SCHEME.test(trimmed) && !WINDOWS_ABSOLUTE_PATH.test(trimmed)) {
    return null
  }

  // Split on raw # / ? before decoding so encoded `%23` / `%3F` inside the
  // path don't get promoted to fragment/query separators (which would point
  // the file opener at the wrong file).
  const hashIndex = trimmed.indexOf("#")
  const rawHash = hashIndex >= 0 ? trimmed.slice(hashIndex) : ""
  const beforeHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed
  const queryIndex = beforeHash.indexOf("?")
  const rawPathPart =
    queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash
  const decodedPath = decodeUriSafely(rawPathPart)
  const pathAndLine = splitPathAndLine(decodedPath)
  const normalizedPath = stripLeadingSlashOnWindows(pathAndLine.path)
  if (!isLocalPathLike(normalizedPath)) return null

  return {
    path: normalizeSlashPath(normalizedPath),
    line: parseHashLine(rawHash) ?? pathAndLine.line,
  }
}

function normalizeWorkspaceRelativePath(path: string): string | null {
  const parts: string[] = []
  for (const part of normalizeSlashPath(path)
    .replace(/^\.\/+/, "")
    .split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }

  const normalized = parts.join("/")
  return normalized || null
}

export function toWorkspaceRelativePath(
  path: string,
  workspacePath: string
): string | null {
  const normalizedPath = normalizeSlashPath(path)
  const normalizedWorkspace = normalizeSlashPath(workspacePath).replace(
    /\/+$/,
    ""
  )
  if (!normalizedPath || !normalizedWorkspace) return null

  if (!normalizedPath.startsWith("/") && !WINDOWS_ABSOLUTE_PATH.test(path)) {
    return normalizeWorkspaceRelativePath(normalizedPath)
  }

  const isCaseInsensitive =
    WINDOWS_ABSOLUTE_PATH.test(normalizedWorkspace) ||
    normalizedWorkspace.startsWith("//")
  const pathForCompare = isCaseInsensitive
    ? normalizedPath.toLowerCase()
    : normalizedPath
  const workspaceForCompare = isCaseInsensitive
    ? normalizedWorkspace.toLowerCase()
    : normalizedWorkspace

  if (pathForCompare === workspaceForCompare) return null
  if (!pathForCompare.startsWith(`${workspaceForCompare}/`)) return null

  return normalizeWorkspaceRelativePath(
    normalizedPath.slice(normalizedWorkspace.length + 1)
  )
}

/**
 * Normalize a tool-call file path (absolute, `~/`, workspace-relative, or a
 * bare relative path) into something `openFilePreview` can consume. Only
 * relative paths still depend on the active folder; the caller checks that.
 */
export function resolveToolFilePath(rawPath: string): string | null {
  const normalized = normalizeSlashPath(rawPath.trim())
  if (!normalized) return null
  if (
    normalized.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH.test(normalized) ||
    normalized === "~" ||
    normalized.startsWith("~/")
  ) {
    return normalized
  }
  return normalized.replace(/^\.\/+/, "")
}

function trimSelectedCandidate(candidate: string): string {
  return candidate
    .trim()
    .replace(/^[([{<]+/, "")
    .replace(/[.,;:!?)}\]>]+$/, "")
}

function parseSelectedPathCandidate(candidate: string): LocalFileTarget | null {
  const trimmed = trimSelectedCandidate(candidate)
  if (!trimmed) return null

  const localTarget = parseLocalFileTarget(trimmed)
  if (localTarget) return localTarget

  if (URL_SCHEME.test(trimmed) && !WINDOWS_ABSOLUTE_PATH.test(trimmed)) {
    return null
  }

  const decodedPath = decodeUriSafely(trimmed)
  const pathAndLine = splitPathAndLine(decodedPath)
  const normalizedPath = normalizeSlashPath(
    stripLeadingSlashOnWindows(pathAndLine.path)
  )
  const hasPathSeparator = normalizedPath.includes("/")
  if (!hasPathSeparator && !FILE_EXTENSION.test(normalizedPath)) return null
  if (
    hasPathSeparator &&
    !FILE_EXTENSION.test(normalizedPath) &&
    !LINE_SUFFIX.test(trimmed)
  ) {
    return null
  }

  return {
    path: normalizedPath,
    line: pathAndLine.line,
  }
}

export function findFirstWorkspaceFileTarget(
  selectedText: string,
  workspacePath: string | null | undefined
): WorkspaceFileTarget | null {
  if (!workspacePath) return null

  for (const match of selectedText.matchAll(SELECTED_PATH_CANDIDATE)) {
    const localTarget = parseSelectedPathCandidate(match[0])
    if (!localTarget) continue

    const relativePath = toWorkspaceRelativePath(
      localTarget.path,
      workspacePath
    )
    if (!relativePath) continue

    return {
      relativePath,
      line: localTarget.line,
    }
  }

  return null
}
