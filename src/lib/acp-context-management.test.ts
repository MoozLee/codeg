import { describe, expect, it } from "vitest"

import {
  DEFAULT_CONTEXT_MANAGEMENT,
  applyContextRuntimeIdentity,
  applyContextUsage,
  deriveContextManagementFromAgentStatus,
  deriveContextManagementFromSelectors,
  formatNormalizedPercent,
  getCompactionTriggerDecision,
  normalizePercent,
  sessionConfigOptionAcceptsValue,
} from "./acp-context-management"
import type {
  AcpAgentStatus,
  AvailableCommandInfo,
  SessionConfigOptionInfo,
} from "./types"

const compactCommand: AvailableCommandInfo = {
  name: "compact",
  description: "Compact context",
  input_hint: null,
}

function agentStatus(
  runtimePatch: Partial<AcpAgentStatus["context_runtime_config"]> = {},
  patch: Partial<Omit<AcpAgentStatus, "context_runtime_config">> = {}
): AcpAgentStatus {
  return {
    agent_type: "claude_code",
    available: true,
    enabled: true,
    installed_version: "1.0.0",
    ...patch,
    context_runtime_config: {
      configured_model: null,
      configured_model_source: null,
      configured_context_window_max_tokens: null,
      context_window_max_source: null,
      auto_compaction_enabled: null,
      auto_compaction_threshold: null,
      native_auto_compact_window: null,
      ...runtimePatch,
    },
  }
}

function booleanOption(currentValue: boolean): SessionConfigOptionInfo {
  return {
    id: "auto_compact",
    name: "Auto compact",
    category: null,
    kind: { type: "boolean", current_value: currentValue },
  }
}

describe("ACP context management", () => {
  it("normalizes percentage fractions once and formats the 0..100 domain", () => {
    expect(normalizePercent(0.35)).toBe(35)
    expect(normalizePercent("35%")).toBe(35)
    expect(formatNormalizedPercent(35)).toBe("35%")
    expect(formatNormalizedPercent(3.5)).toBe("3.5%")
  })

  it("derives context state only from the backend allowlist DTO", () => {
    const status = agentStatus({
      configured_model: "env-model",
      configured_model_source: "agent_env",
      configured_context_window_max_tokens: 300000,
      context_window_max_source: "agent_env",
      auto_compaction_enabled: true,
      auto_compaction_threshold: 35,
      native_auto_compact_window: 300000,
    })
    const state = deriveContextManagementFromAgentStatus(status)

    expect(state.configuredModel).toBe("env-model")
    expect(state.configuredModelSource).toBe("agent_env")
    expect(state.configuredContextWindowMaxTokens).toBe(300000)
    expect(state.contextWindowMaxSource).toBe("agent_env")
    expect(state.autoCompactionThreshold).toBe(35)
    expect(state.compactionSupport).toBe("native_managed")
    expect(status).not.toHaveProperty("env")
    expect(status).not.toHaveProperty("config_json")
    expect(status).not.toHaveProperty("config_file_path")
  })

  it("preserves null backend values without parsing raw configuration", () => {
    const state = deriveContextManagementFromAgentStatus(agentStatus())

    expect(state.configuredContextWindowMaxTokens).toBeNull()
    expect(state.compactionSupport).toBe("unknown")
  })

  it("maps boolean config and advertised commands to agent-managed support", () => {
    const state = deriveContextManagementFromSelectors(
      [booleanOption(true)],
      [compactCommand]
    )
    expect(state.autoCompactionEnabled).toBe(true)
    expect(state.compactionSupport).toBe("agent_managed")
  })

  it("tracks the advertised selector as the runtime model", () => {
    const modelOption: SessionConfigOptionInfo = {
      id: "model",
      name: "Model",
      category: "model",
      kind: {
        type: "select",
        current_value: "opus",
        options: [{ value: "opus", name: "Opus" }],
        groups: [],
      },
    }
    const state = deriveContextManagementFromSelectors([modelOption], [])
    expect(state.configuredModel).toBe("opus")
    expect(state.configuredModelSource).toBe("selector")
    expect(state.runtimeModel).toBe("opus")
  })

  it("accepts only values advertised by the option kind", () => {
    const select: SessionConfigOptionInfo = {
      id: "model",
      name: "Model",
      category: "model",
      kind: {
        type: "select",
        current_value: "opus",
        options: [{ value: "opus", name: "Opus" }],
        groups: [],
      },
    }
    expect(sessionConfigOptionAcceptsValue(select, "opus")).toBe(true)
    expect(sessionConfigOptionAcceptsValue(select, "stale-model")).toBe(false)
    expect(sessionConfigOptionAcceptsValue(select, true)).toBe(false)
    expect(sessionConfigOptionAcceptsValue(booleanOption(false), true)).toBe(
      true
    )
  })

  it("resets session-scoped state when runtime identity changes", () => {
    const statusState = deriveContextManagementFromAgentStatus(
      agentStatus({
        configured_model: "opus",
        configured_model_source: "agent_env",
      }),
      DEFAULT_CONTEXT_MANAGEMENT,
      "connection",
      null
    )
    const selectorState = deriveContextManagementFromSelectors(
      [
        booleanOption(true),
        {
          id: "model",
          name: "Model",
          category: "model",
          kind: {
            type: "select",
            current_value: "session-model",
            options: [{ value: "session-model", name: "Session model" }],
            groups: [],
          },
        },
      ],
      [compactCommand],
      statusState
    )
    const initial = applyContextUsage(
      {
        ...selectorState,
        compactionStatus: "failed",
        activeCompactionOperationId: "old-operation",
        lastCompactionError: "old session",
      },
      { used: 100000, size: 200000 }
    )
    const updated = applyContextRuntimeIdentity(
      initial,
      "connection",
      "session-2"
    )
    expect(updated.runtimeConfig?.sessionId).toBe("session-2")
    expect(updated.runtimeConfig?.selectorModel).toBeNull()
    expect(updated.configuredModel).toBe("opus")
    expect(updated.runtimeModel).toBeNull()
    expect(updated.autoCompactionEnabled).toBeNull()
    expect(updated.compactionSupport).toBe("unknown")
    expect(updated.runtimeContextWindowMaxTokens).toBeNull()
    expect(updated.compactionStatus).toBe("idle")
    expect(updated.activeCompactionOperationId).toBeNull()
    expect(updated.lastCompactionError).toBeNull()
  })

  it("never selects app-side triggering for native-managed Claude", () => {
    const state = deriveContextManagementFromAgentStatus(
      agentStatus({
        configured_context_window_max_tokens: 1_000_000,
        context_window_max_source: "agent_env",
        auto_compaction_enabled: true,
        native_auto_compact_window: 1_000_000,
      })
    )
    expect(
      getCompactionTriggerDecision({
        connectionId: "conn",
        sessionId: "session",
        status: "connected",
        usage: { used: 900000, size: 1000000 },
        management: state,
        commands: [compactCommand],
      })
    ).toBeNull()
  })

  it("builds a stable 5 percent zone key for eligible agent-managed usage", () => {
    const state = applyContextUsage(
      {
        ...DEFAULT_CONTEXT_MANAGEMENT,
        configuredContextWindowMaxTokens: 1_000_000,
        autoCompactionEnabled: true,
        autoCompactionThreshold: 35,
        compactionSupport: "agent_managed",
      },
      { used: 351000, size: 1000000 }
    )
    const decision = getCompactionTriggerDecision({
      connectionId: "conn",
      sessionId: "session",
      status: "connected",
      usage: { used: 351000, size: 1000000 },
      management: state,
      commands: [compactCommand],
    })
    expect(decision).toEqual({
      command: "/compact",
      key: "conn:session:35:1000000:35",
    })
    expect(
      getCompactionTriggerDecision({
        connectionId: "conn",
        sessionId: "next-session",
        status: "connected",
        usage: { used: 351000, size: 1000000 },
        management: state,
        commands: [compactCommand],
      })?.key
    ).toBe("conn:next-session:35:1000000:35")
    expect(
      getCompactionTriggerDecision({
        connectionId: "conn",
        sessionId: "session",
        status: "prompting",
        usage: { used: 351000, size: 1000000 },
        management: state,
        commands: [compactCommand],
      })
    ).toBeNull()
    expect(
      getCompactionTriggerDecision({
        connectionId: "conn",
        sessionId: null,
        status: "connected",
        usage: { used: 351000, size: 1000000 },
        management: state,
        commands: [compactCommand],
      })
    ).toBeNull()
  })

  it("marks a smaller runtime window as clamped", () => {
    const state = applyContextUsage(
      {
        ...DEFAULT_CONTEXT_MANAGEMENT,
        configuredContextWindowMaxTokens: 1_000_000,
      },
      { used: 274000, size: 200000 }
    )
    expect(state.runtimeContextWindowMaxTokens).toBe(200000)
    expect(state.runtimeContextWindowClamped).toBe(true)
  })
})
