import type {
  AcpAgentStatus,
  AgentType,
  AvailableCommandInfo,
  ConfiguredModelSource as BackendConfiguredModelSource,
  ContextRuntimeConfigInfo,
  ContextWindowMaxSource as BackendContextWindowMaxSource,
  ConnectionStatus,
  MaintenanceCommand,
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

export type ConfiguredModelSource = BackendConfiguredModelSource | "selector"

export type ContextWindowMaxSource = BackendContextWindowMaxSource

export interface RuntimeConfigSnapshot {
  agentType: AgentType
  connectionId: string | null
  sessionId: string | null
  agentConfig: ContextRuntimeConfigInfo
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
  activeCompactionOperationId: string | null
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
  activeCompactionOperationId: null,
  lastCompactionError: null,
  runtimeConfig: null,
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

function hasNativeClaudeContextConfig(
  agentType: AgentType,
  runtime: ContextRuntimeConfigInfo
): boolean {
  return (
    agentType === "claude_code" &&
    runtime.auto_compaction_enabled === true &&
    (runtime.native_auto_compact_window != null ||
      runtime.auto_compaction_threshold != null)
  )
}

export function deriveContextManagementFromAgentStatus(
  agent: AcpAgentStatus | null,
  previous: ContextManagementState = DEFAULT_CONTEXT_MANAGEMENT,
  connectionId: string | null = null,
  sessionId: string | null = null
): ContextManagementState {
  if (!agent) return previous

  const sameIdentity =
    previous.runtimeConfig?.agentType === agent.agent_type &&
    previous.runtimeConfig.connectionId === connectionId &&
    previous.runtimeConfig.sessionId === sessionId
  const base = sameIdentity ? previous : DEFAULT_CONTEXT_MANAGEMENT
  const runtime = agent.context_runtime_config
  const nativeClaude = hasNativeClaudeContextConfig(agent.agent_type, runtime)

  return {
    ...base,
    configuredModel: runtime.configured_model,
    configuredModelSource: runtime.configured_model_source,
    configuredContextWindowMaxTokens:
      runtime.configured_context_window_max_tokens,
    contextWindowMaxSource: runtime.context_window_max_source,
    autoCompactionEnabled:
      runtime.auto_compaction_enabled ?? base.autoCompactionEnabled,
    autoCompactionThreshold:
      runtime.auto_compaction_threshold ?? base.autoCompactionThreshold,
    compactionSupport: nativeClaude ? "native_managed" : base.compactionSupport,
    runtimeConfig: {
      agentType: agent.agent_type,
      connectionId,
      sessionId,
      agentConfig: runtime,
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

  const agentConfig = state.runtimeConfig.agentConfig
  const nativeClaude = hasNativeClaudeContextConfig(
    state.runtimeConfig.agentType,
    agentConfig
  )
  return {
    ...state,
    configuredModel: agentConfig.configured_model,
    configuredModelSource: agentConfig.configured_model_source,
    runtimeModel: null,
    configuredContextWindowMaxTokens:
      agentConfig.configured_context_window_max_tokens,
    contextWindowMaxSource: agentConfig.context_window_max_source,
    runtimeContextWindowMaxTokens: null,
    runtimeContextWindowClamped: false,
    autoCompactionEnabled: agentConfig.auto_compaction_enabled,
    autoCompactionThreshold: agentConfig.auto_compaction_threshold,
    compactionSupport: nativeClaude ? "native_managed" : "unknown",
    compactionStatus: "idle",
    activeCompactionOperationId: null,
    lastCompactionError: null,
    runtimeConfig: {
      ...state.runtimeConfig,
      connectionId,
      sessionId,
      selectorModel: null,
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
  command: MaintenanceCommand
  key: string
}

export function getCompactionTriggerDecision(
  input: CompactionTriggerDecisionInput
): CompactionTriggerDecision | null {
  const { management, usage } = input
  if (
    input.status !== "connected" ||
    !input.sessionId ||
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
  const commandName: MaintenanceCommand =
    command.name.replace(/^\//, "").toLowerCase() === "compact"
      ? "/compact"
      : "/summarize"
  return {
    command: commandName,
    key: `${input.connectionId}:${input.sessionId}:${threshold}:${contextMax}:${zone}`,
  }
}
