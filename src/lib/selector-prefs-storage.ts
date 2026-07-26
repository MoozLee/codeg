"use client"

import { isValidSessionConfigValue } from "@/lib/acp-context-management"
import type { SessionModeStateInfo } from "@/lib/types"

const STORAGE_KEY = "codeg:selector-prefs"

interface SelectorPrefs {
  modeId?: string
  configValues?: Record<string, string>
}

type AllPrefs = Record<string, SelectorPrefs>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeStoredConfigValue(value: unknown): string | undefined {
  const normalized = nonEmptyString(value)
  return normalized && isValidSessionConfigValue(normalized)
    ? normalized
    : undefined
}

function serializeConfigValue(value: string | boolean): string | undefined {
  if (typeof value === "boolean") return value ? "true" : "false"
  return normalizeStoredConfigValue(value)
}

function normalizeConfigValues(
  value: unknown
): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).flatMap(([configId, configValue]) => {
    const id = nonEmptyString(configId)
    const normalized = normalizeStoredConfigValue(configValue)
    return id && normalized ? [[id, normalized] as const] : []
  })
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizePrefs(value: unknown): SelectorPrefs | undefined {
  if (!isRecord(value)) return undefined
  const modeId = nonEmptyString(value.modeId)
  const configValues = normalizeConfigValues(value.configValues)
  if (!modeId && !configValues) return undefined
  return { modeId, configValues }
}

function readAll(): AllPrefs {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([agentType, prefs]) => {
        const id = nonEmptyString(agentType)
        const normalized = normalizePrefs(prefs)
        return id && normalized ? [[id, normalized] as const] : []
      })
    )
  } catch {
    return {}
  }
}

function writeAll(all: AllPrefs) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Storage is optional; keep the in-session selector state usable.
  }
}

function updatePrefs(
  agentType: string,
  update: (prefs: SelectorPrefs) => SelectorPrefs
) {
  const all = readAll()
  const existing = all[agentType]
  all[agentType] = update({
    modeId: existing?.modeId,
    configValues: existing?.configValues,
  })
  writeAll(all)
}

export function getSavedModeId(agentType: string): string | null {
  return readAll()[agentType]?.modeId ?? null
}

export function getSavedPrefsForConnect(agentType: string): {
  modeId: string | null
  configValues: Record<string, string> | null
} {
  const prefs = readAll()[agentType]
  if (!prefs) return { modeId: null, configValues: null }
  return {
    modeId: prefs.modeId ?? null,
    configValues:
      prefs.configValues && Object.keys(prefs.configValues).length > 0
        ? prefs.configValues
        : null,
  }
}

export function saveModePreference(
  agentType: string,
  modes: SessionModeStateInfo
) {
  updatePrefs(agentType, (prefs) => ({
    ...prefs,
    modeId: modes.current_mode_id,
  }))
}

export function saveConfigPreference(
  agentType: string,
  configId: string,
  value: string | boolean
) {
  const id = nonEmptyString(configId)
  const normalized = serializeConfigValue(value)
  if (!id || !normalized) return
  updatePrefs(agentType, (prefs) => ({
    ...prefs,
    configValues: { ...prefs.configValues, [id]: normalized },
  }))
}
