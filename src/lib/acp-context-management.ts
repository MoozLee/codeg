import type {
  AcpAgentStatus,
  AgentType,
  AvailableCommandInfo,
  ConnectionStatus,
  SessionConfigOptionInfo,
  SessionUsageUpdateInfo,
} from "@/lib/types"

export type CompactionSupport =
  | "unknown"
  | "unsupported"
  | "agent_managed"
  | "native_managed"

export type CompactionTriggerStatus =
  | "idle"
  | "triggered"
  | "running"
  | "completed"
  | "failed"

export type ConfiguredModelSource =
  | "agent_env"
  | "agent_config_env"
  | "agent_root_config"
  | "selector"

export type ContextWindowMaxSource =
  | "agent_env"
  | "agent_config_env"
  | "agent_root_config"

export interface RuntimeConfigField {
  key: string
  value: string
}

export interface RuntimeConfigSnapshot {
  agentType: AgentType
  configFilePath: string | null
  connectionId: string | null
  sessionId: string | null
  safeEnvFields: RuntimeConfigField[]
  safeRootConfigFields: RuntimeConfigField[]
  safeConfigEnvFields: RuntimeConfigField[]
  selectorModel: string | null
}

export interface ContextManagementState {
  configuredModel: string | null
  configuredModelSource: ConfiguredModelSource | null
  runtimeModel: string | null
  configuredContextWindowMaxTokens: number | null
  contextWindowMaxSource: ContextWindowMaxSource | null
  runtimeContextWindowMaxTokens: number | null
  runtimeContextWindowClamped: boolean
  autoCompactionEnabled: boolean | null
  autoCompactionThreshold: number | null
  compactionSupport: CompactionSupport
  compactionStatus: CompactionTriggerStatus
  lastCompactionError: string | null
  runtimeConfig: RuntimeConfigSnapshot | null
}

export const DEFAULT_AUTO_COMPACTION_THRESHOLD = 80

export function isValidSessionConfigValue(value: string | boolean): boolean {
  if (typeof value === "boolean") return true
  const normalized = value.trim().toLowerCase()
  return (
    normalized.length > 0 && normalized !== "null" && normalized !== "undefined"
  )
}

export function sessionConfigOptionAcceptsValue(
  option: SessionConfigOptionInfo,
  value: string | boolean
): boolean {
  if (!isValidSessionConfigValue(value)) return false
  if (option.kind.type === "boolean") return typeof value === "boolean"
  if (typeof value !== "string") return false
  return (
    option.kind.options.some((candidate) => candidate.value === value) ||
    option.kind.groups.some((group) =>
      group.options.some((candidate) => candidate.value === value)
    )
  )
}

export const DEFAULT_CONTEXT_MANAGEMENT: ContextManagementState = {
  configuredModel: null,
  configuredModelSource: null,
  runtimeModel: null,
  configuredContextWindowMaxTokens: null,
  contextWindowMaxSource: null,
  runtimeContextWindowMaxTokens: null,
  runtimeContextWindowClamped: false,
  autoCompactionEnabled: null,
  autoCompactionThreshold: null,
  compactionSupport: "unknown",
  compactionStatus: "idle",
  lastCompactionError: null,
  runtimeConfig: null,
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseJsonObject(raw: string | null | undefined) {
  if (!raw) return null
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return null
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function firstRecordString(
  record: Record<string, unknown> | null,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = stringValue(record?.[key])
    if (value) return value
  }
  return null
}

function firstEnvString(
  env: Record<string, string> | null | undefined,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = stringValue(env?.[key])
    if (value) return value
  }
  return null
}

export function normalizePercent(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const normalized = String(value).trim().replace(/%$/, "")
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  const percent = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed
  return percent >= 1 && percent <= 100 ? percent : null
}

export function formatNormalizedPercent(percent: number | null): string {
  if (percent == null) return "--"
  return `${percent.toFixed(percent >= 10 ? 0 : 1)}%`
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const parsed = Number(String(value).trim())
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function firstPositiveInteger(
  record: Record<string, unknown> | Record<string, string> | null | undefined,
  keys: string[],
  bounds?: { min: number; max: number }
): number | null {
  for (const key of keys) {
    const value = positiveInteger(record?.[key])
    if (value == null) continue
    if (bounds && (value < bounds.min || value > bounds.max)) continue
    return value
  }
  return null
}

function firstPercent(
  record: Record<string, unknown> | Record<string, string> | null | undefined,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = normalizePercent(record?.[key])
    if (value != null) return value
  }
  return null
}

const CONTEXT_FIELD_PATTERNS = ["model", "compact", "compaction", "context"]
const SECRET_FIELD_PATTERNS = [
  "key",
  "token",
  "secret",
  "password",
  "credential",
  "auth",
]

export function safeContextConfigFields(
  record: Record<string, unknown> | Record<string, string> | null | undefined
): RuntimeConfigField[] {
  if (!record) return []
  return Object.entries(record)
    .filter(([key, value]) => {
      const normalized = key.toLowerCase()
      if (
        !CONTEXT_FIELD_PATTERNS.some((pattern) =>
          normalized.includes(pattern)
        ) ||
        SECRET_FIELD_PATTERNS.some((pattern) => normalized.includes(pattern))
      ) {
        return false
      }
      return ["string", "number", "boolean"].includes(typeof value)
    })
    .map(([key, value]) => ({ key, value: String(value) }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function modelEnvKeys(agentType: AgentType): string[] {
  switch (agentType) {
    case "claude_code":
      return ["ANTHROPIC_MODEL"]
    case "gemini":
      return ["GEMINI_MODEL", "GOOGLE_GEMINI_MODEL", "MODEL"]
    case "grok":
      return ["GROK_DEFAULT_MODEL", "MODEL"]
    default:
      return ["OPENAI_MODEL", "MODEL", "ANTHROPIC_MODEL", "GEMINI_MODEL"]
  }
}

export function deriveContextManagementFromAgentStatus(
  agent: AcpAgentStatus | null,
  previous: ContextManagementState = DEFAULT_CONTEXT_MANAGEMENT,
  connectionId: string | null = null,
  sessionId: string | null = null
): ContextManagementState {
  if (!agent) return previous

  const config = parseJsonObject(agent.config_json)
  const configEnv = asRecord(config?.env)
  const sameIdentity =
    previous.runtimeConfig?.agentType === agent.agent_type &&
    previous.runtimeConfig.configFilePath ===
      (agent.config_file_path ?? null) &&
    previous.runtimeConfig.connectionId === connectionId &&
    previous.runtimeConfig.sessionId === sessionId
  const base = sameIdentity ? previous : DEFAULT_CONTEXT_MANAGEMENT

  const modelKeys = modelEnvKeys(agent.agent_type)
  const envModel = firstEnvString(agent.env, modelKeys)
  const configEnvModel = firstRecordString(configEnv, modelKeys)
  const rootModel = firstRecordString(config, ["model", "custom_model_id"])
  const configuredModel = envModel ?? configEnvModel ?? rootModel
  const configuredModelSource: ConfiguredModelSource | null = envModel
    ? "agent_env"
    : configEnvModel
      ? "agent_config_env"
      : rootModel
        ? "agent_root_config"
        : null

  const claudeBounds = { min: 100_000, max: 1_000_000 }
  const envContextMax =
    agent.agent_type === "claude_code"
      ? firstPositiveInteger(
          agent.env,
          ["CLAUDE_CODE_AUTO_COMPACT_WINDOW"],
          claudeBounds
        )
      : null
  const configEnvContextMax =
    agent.agent_type === "claude_code"
      ? firstPositiveInteger(
          configEnv,
          ["CLAUDE_CODE_AUTO_COMPACT_WINDOW"],
          claudeBounds
        )
      : null
  const rootContextMax =
    agent.agent_type === "claude_code"
      ? firstPositiveInteger(
          config,
          [
            "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
            "claudeCodeAutoCompactWindow",
            "claude_code_auto_compact_window",
          ],
          claudeBounds
        )
      : agent.agent_type === "grok"
        ? firstPositiveInteger(config, [
            "custom_context_window",
            "customContextWindow",
          ])
        : null
  const configuredContextWindowMaxTokens =
    envContextMax ?? configEnvContextMax ?? rootContextMax
  const contextWindowMaxSource: ContextWindowMaxSource | null =
    envContextMax != null
      ? "agent_env"
      : configEnvContextMax != null
        ? "agent_config_env"
        : rootContextMax != null
          ? "agent_root_config"
          : null

  const claudeThreshold =
    firstPercent(agent.env, ["CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"]) ??
    firstPercent(configEnv, ["CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"]) ??
    firstPercent(config, [
      "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
      "claudeAutocompactPctOverride",
      "claude_autocompact_pct_override",
    ])
  const grokThreshold = firstPercent(config, [
    "auto_compact_threshold_percent",
    "autoCompactThresholdPercent",
  ])
  const threshold = claudeThreshold ?? grokThreshold
  const nativeClaude =
    agent.agent_type === "claude_code" &&
    (configuredContextWindowMaxTokens != null || claudeThreshold != null)

  return {
    ...base,
    configuredModel,
    configuredModelSource,
    configuredContextWindowMaxTokens,
    contextWindowMaxSource,
    autoCompactionEnabled:
      nativeClaude || grokThreshold != null ? true : base.autoCompactionEnabled,
    autoCompactionThreshold: threshold ?? base.autoCompactionThreshold,
    compactionSupport: nativeClaude ? "native_managed" : base.compactionSupport,
    runtimeConfig: {
      agentType: agent.agent_type,
      configFilePath: agent.config_file_path ?? null,
      connectionId,
      sessionId,
      safeEnvFields: safeContextConfigFields(agent.env),
      safeRootConfigFields: safeContextConfigFields(config),
      safeConfigEnvFields: safeContextConfigFields(configEnv),
      selectorModel: sameIdentity
        ? (previous.runtimeConfig?.selectorModel ?? null)
        : null,
    },
  }
}

function booleanConfigValue(
  option: SessionConfigOptionInfo | undefined
): boolean | null {
  if (!option) return null
  if (option.kind.type === "boolean") return option.kind.current_value
  const value = option.kind.current_value.trim().toLowerCase()
  if (["true", "on", "yes", "enabled", "enable", "auto"].includes(value)) {
    return true
  }
  if (
    ["false", "off", "no", "disabled", "disable", "manual", "never"].includes(
      value
    )
  ) {
    return false
  }
  return null
}

export function findCompactionCommand(
  commands: AvailableCommandInfo[] | null
): AvailableCommandInfo | null {
  return (
    commands?.find((command) => {
      const name = command.name.replace(/^\//, "").toLowerCase()
      return name === "compact" || name === "summarize"
    }) ?? null
  )
}

export function deriveContextManagementFromSelectors(
  options: SessionConfigOptionInfo[] | null,
  commands: AvailableCommandInfo[] | null,
  previous: ContextManagementState = DEFAULT_CONTEXT_MANAGEMENT
): ContextManagementState {
  const modelOption = options?.find((option) => option.category === "model")
  const selectorModel = modelOption
    ? String(modelOption.kind.current_value)
    : null
  const autoCompactOption = options?.find((option) => {
    const text = `${option.id} ${option.name}`.toLowerCase()
    return /auto[_ -]?(compact|compaction)/.test(text)
  })
  const thresholdOption = options?.find((option) => {
    const text = `${option.id} ${option.name}`.toLowerCase()
    return /(compact|compaction|context)[_ -]?threshold/.test(text)
  })
  const threshold =
    thresholdOption?.kind.type === "select"
      ? normalizePercent(thresholdOption.kind.current_value)
      : null
  const command = findCompactionCommand(commands)
  const compactionSupport: CompactionSupport =
    previous.compactionSupport === "native_managed"
      ? "native_managed"
      : command
        ? "agent_managed"
        : commands
          ? "unsupported"
          : previous.compactionSupport
  const useSelectorModel =
    selectorModel != null && previous.configuredModelSource == null

  return {
    ...previous,
    configuredModel: useSelectorModel
      ? selectorModel
      : previous.configuredModel,
    configuredModelSource: useSelectorModel
      ? "selector"
      : previous.configuredModelSource,
    runtimeModel: selectorModel ?? previous.runtimeModel,
    autoCompactionEnabled:
      booleanConfigValue(autoCompactOption) ?? previous.autoCompactionEnabled,
    autoCompactionThreshold: threshold ?? previous.autoCompactionThreshold,
    compactionSupport,
    runtimeConfig: previous.runtimeConfig
      ? { ...previous.runtimeConfig, selectorModel }
      : null,
  }
}

export function applyContextRuntimeIdentity(
  state: ContextManagementState,
  connectionId: string,
  sessionId: string | null
): ContextManagementState {
  if (!state.runtimeConfig) return state
  const identityChanged =
    state.runtimeConfig.connectionId !== connectionId ||
    state.runtimeConfig.sessionId !== sessionId
  if (!identityChanged) return state
  return {
    ...state,
    runtimeContextWindowMaxTokens: null,
    runtimeContextWindowClamped: false,
    compactionStatus: "idle",
    lastCompactionError: null,
    runtimeConfig: {
      ...state.runtimeConfig,
      connectionId,
      sessionId,
    },
  }
}

export function applyContextUsage(
  state: ContextManagementState,
  usage: SessionUsageUpdateInfo
): ContextManagementState {
  const runtimeMax = usage.size > 0 ? usage.size : null
  return {
    ...state,
    runtimeContextWindowMaxTokens: runtimeMax,
    runtimeContextWindowClamped:
      state.configuredContextWindowMaxTokens != null &&
      runtimeMax != null &&
      runtimeMax < state.configuredContextWindowMaxTokens,
  }
}

export interface CompactionTriggerDecisionInput {
  connectionId: string
  sessionId: string | null
  status: ConnectionStatus
  usage: SessionUsageUpdateInfo | null
  management: ContextManagementState
  commands: AvailableCommandInfo[] | null
}

export interface CompactionTriggerDecision {
  command: string
  key: string
}

export function getCompactionTriggerDecision(
  input: CompactionTriggerDecisionInput
): CompactionTriggerDecision | null {
  const { management, usage } = input
  if (
    input.status !== "connected" ||
    !usage ||
    usage.used <= 0 ||
    management.compactionSupport !== "agent_managed" ||
    management.autoCompactionEnabled !== true ||
    management.compactionStatus === "triggered" ||
    management.compactionStatus === "running"
  ) {
    return null
  }
  const command = findCompactionCommand(input.commands)
  if (!command) return null
  const contextMax = management.configuredContextWindowMaxTokens ?? usage.size
  if (contextMax <= 0) return null
  const percent = (usage.used / contextMax) * 100
  const threshold =
    management.autoCompactionThreshold ?? DEFAULT_AUTO_COMPACTION_THRESHOLD
  if (percent < threshold) return null
  const zone = Math.floor(percent / 5) * 5
  const session = input.sessionId ?? input.connectionId
  return {
    command: command.name.startsWith("/") ? command.name : `/${command.name}`,
    key: `${input.connectionId}:${session}:${threshold}:${contextMax}:${zone}`,
  }
}
