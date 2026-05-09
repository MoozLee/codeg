"use client"

/**
 * Persists user's selector preferences (mode & config option selections)
 * per agentType to localStorage, so they survive session restarts.
 *
 * Structure hash is stored alongside values — when the available options
 * change (new/removed/renamed items) the saved prefs are discarded.
 *
 * Agents may emit empty selectors during early init (config_options=None
 * becomes []), followed by real selectors later. We therefore only apply
 * or invalidate prefs when incoming data is non-empty. Stale prefs for
 * agents that genuinely lose all selectors are cleaned up at
 * `selectors_ready` via `clearStalePrefs()`.
 */

import type { SessionConfigOptionInfo, SessionModeStateInfo } from "@/lib/types"

const STORAGE_KEY = "codeg:selector-prefs"

interface SelectorPrefs {
  modeId?: string
  modesHash?: string
  configValues?: Record<string, string | boolean>
  configHash?: string
}

type AllPrefs = Record<string, SelectorPrefs>

function readAll(): AllPrefs {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AllPrefs) : {}
  } catch {
    return {}
  }
}

function writeAll(all: AllPrefs) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

function updatePrefs(
  agentType: string,
  fn: (prefs: SelectorPrefs) => SelectorPrefs
) {
  const all = readAll()
  all[agentType] = fn(all[agentType] ?? {})
  writeAll(all)
}

// ── Hash helpers ──

function hashModes(modes: SessionModeStateInfo): string {
  return modes.available_modes.map((m) => m.id).join("\0")
}

function hashConfigOptions(options: SessionConfigOptionInfo[]): string {
  return options
    .map((o) => {
      if (o.kind.type === "select") {
        const vals = o.kind.options.map((v) => v.value).join(",")
        return `${o.id}:select:${vals}`
      }
      return `${o.id}:boolean`
    })
    .join("\0")
}

// ── Read ──

/** Read saved mode id for an agent (no validation, just the raw value). */
export function getSavedModeId(agentType: string): string | null {
  const all = readAll()
  return all[agentType]?.modeId ?? null
}

// ── Save (user actions only) ──

export function saveModePreference(
  agentType: string,
  modes: SessionModeStateInfo
) {
  updatePrefs(agentType, (prefs) => ({
    ...prefs,
    modeId: modes.current_mode_id,
    modesHash: hashModes(modes),
  }))
}

export function saveConfigPreference(
  agentType: string,
  configId: string,
  valueId: string | boolean,
  allOptions: SessionConfigOptionInfo[]
) {
  updatePrefs(agentType, (prefs) => ({
    ...prefs,
    configValues: { ...prefs.configValues, [configId]: valueId },
    configHash: hashConfigOptions(allOptions),
  }))
}

// ── Apply (on incoming server events) ──

/**
 * Apply saved mode preference to incoming server modes.
 * Skips empty mode lists (agent still initializing).
 * Clears prefs when structure genuinely changes.
 */
export function applySavedModePreference(
  agentType: string,
  modes: SessionModeStateInfo
): SessionModeStateInfo {
  const all = readAll()
  const prefs = all[agentType]
  if (!prefs?.modeId || !prefs.modesHash) return modes
  if (modes.available_modes.length === 0) return modes

  const incomingHash = hashModes(modes)
  if (prefs.modesHash !== incomingHash) {
    delete prefs.modeId
    delete prefs.modesHash
    all[agentType] = prefs
    writeAll(all)
    return modes
  }

  if (!modes.available_modes.some((m) => m.id === prefs.modeId)) {
    return modes
  }

  if (modes.current_mode_id === prefs.modeId) return modes

  return { ...modes, current_mode_id: prefs.modeId! }
}

/**
 * Apply saved config option preferences to incoming server config options.
 * Skips empty option lists (agent still initializing).
 * Clears prefs when structure genuinely changes.
 */
export function applySavedConfigPreferences(
  agentType: string,
  options: SessionConfigOptionInfo[]
): SessionConfigOptionInfo[] {
  const all = readAll()
  const prefs = all[agentType]
  if (!prefs?.configValues || !prefs.configHash) return options
  if (options.length === 0) return options

  const incomingHash = hashConfigOptions(options)
  if (prefs.configHash !== incomingHash) {
    delete prefs.configValues
    delete prefs.configHash
    all[agentType] = prefs
    writeAll(all)
    return options
  }

  let changed = false
  const merged = options.map((opt) => {
    const savedValue = prefs.configValues![opt.id]
    if (opt.kind.type === "select") {
      if (
        typeof savedValue !== "string" ||
        savedValue === opt.kind.current_value
      ) {
        return opt
      }
      if (!opt.kind.options.some((o) => o.value === savedValue)) return opt
      changed = true
      return {
        ...opt,
        kind: { ...opt.kind, current_value: savedValue },
      }
    }

    if (
      typeof savedValue !== "boolean" ||
      savedValue === opt.kind.current_value
    ) {
      return opt
    }
    changed = true
    return {
      ...opt,
      kind: { ...opt.kind, current_value: savedValue },
    }
  })

  return changed ? merged : options
}

// ── Cleanup (called at selectors_ready) ──

/**
 * Called when `selectors_ready` fires — initialization is complete.
 * If the agent ended up with no modes / no config options, clear
 * any stale saved prefs for that category so they don't linger forever.
 */
export function clearStalePrefs(
  agentType: string,
  hasModes: boolean,
  hasConfigOptions: boolean
) {
  const all = readAll()
  const prefs = all[agentType]
  if (!prefs) return

  let dirty = false
  if (!hasModes && (prefs.modeId || prefs.modesHash)) {
    delete prefs.modeId
    delete prefs.modesHash
    dirty = true
  }
  if (!hasConfigOptions && (prefs.configValues || prefs.configHash)) {
    delete prefs.configValues
    delete prefs.configHash
    dirty = true
  }
  if (!dirty) return

  const isEmpty =
    !prefs.modeId &&
    !prefs.modesHash &&
    !prefs.configValues &&
    !prefs.configHash
  if (isEmpty) {
    delete all[agentType]
  } else {
    all[agentType] = prefs
  }
  writeAll(all)
}
