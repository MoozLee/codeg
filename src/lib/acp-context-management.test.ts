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
  safeContextConfigFields,
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

function agentStatus(patch: Partial<AcpAgentStatus> = {}): AcpAgentStatus {
  return {
    agent_type: "claude_code",
    available: true,
    enabled: true,
    installed_version: "1.0.0",
    env: {},
    config_json: null,
    config_file_path: "/tmp/settings.json",
    ...patch,
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

  it("keeps only context/model scalars and excludes secrets", () => {
    expect(
      safeContextConfigFields({
        ANTHROPIC_MODEL: "opus",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: 300000,
        ANTHROPIC_AUTH_TOKEN: "secret",
        modelApiKey: "secret",
        unrelated: "hidden",
      })
    ).toEqual([
      { key: "ANTHROPIC_MODEL", value: "opus" },
      { key: "CLAUDE_CODE_AUTO_COMPACT_WINDOW", value: "300000" },
    ])
  })

  it("uses effective env before config.env and root config", () => {
    const state = deriveContextManagementFromAgentStatus(
      agentStatus({
        env: {
          ANTHROPIC_MODEL: "env-model",
          CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000",
          ANTHROPIC_AUTH_TOKEN: "must-not-surface",
        },
        config_json: JSON.stringify({
          model: "root-model",
          env: {
            ANTHROPIC_MODEL: "config-env-model",
            CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000",
          },
        }),
      })
    )

    expect(state.configuredModel).toBe("env-model")
    expect(state.configuredModelSource).toBe("agent_env")
    expect(state.configuredContextWindowMaxTokens).toBe(300000)
    expect(state.contextWindowMaxSource).toBe("agent_env")
    expect(state.compactionSupport).toBe("native_managed")
    expect(
      state.runtimeConfig?.safeEnvFields.some((field) =>
        field.key.includes("TOKEN")
      )
    ).toBe(false)
  })

  it("rejects fractional configured context-window values", () => {
    const state = deriveContextManagementFromAgentStatus(
      agentStatus({
        env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000.5" },
      })
    )

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
    const initial = applyContextUsage(
      {
        ...deriveContextManagementFromAgentStatus(
          agentStatus({ env: { ANTHROPIC_MODEL: "opus" } }),
          DEFAULT_CONTEXT_MANAGEMENT,
          "connection",
          null
        ),
        compactionStatus: "failed",
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
    expect(updated.configuredModel).toBe("opus")
    expect(updated.runtimeContextWindowMaxTokens).toBeNull()
    expect(updated.compactionStatus).toBe("idle")
    expect(updated.lastCompactionError).toBeNull()
  })

  it("never selects app-side triggering for native-managed Claude", () => {
    const state = deriveContextManagementFromAgentStatus(
      agentStatus({
        env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1000000" },
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
