import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  StatusBarTokens,
  buildStatusBarTokenViewModel,
} from "./status-bar-tokens"
import { DEFAULT_CONTEXT_MANAGEMENT } from "@/lib/acp-context-management"
import type { ContextManagementState } from "@/lib/acp-context-management"
import type {
  AgentType,
  SessionStats,
  SessionUsageUpdateInfo,
} from "@/lib/types"

const h = vi.hoisted(() => ({
  connection: null as {
    agentType: AgentType
    usage: SessionUsageUpdateInfo
    contextManagement: ContextManagementState
  } | null,
  sessionStats: null as SessionStats | null,
}))

vi.mock("@/contexts/acp-connections-context", () => ({
  useConnectionStore: () => ({
    getActiveKey: () => "active",
    subscribeActiveKey: () => () => {},
    getConnection: () => h.connection,
    subscribeKey: () => () => {},
  }),
}))

vi.mock("@/contexts/session-stats-context", () => ({
  useSessionStats: () => ({ sessionStats: h.sessionStats }),
}))

const messages: Record<string, string> = {
  contextWindowUsageAria: "Context window usage",
  contextWindow: "Context Window",
  usedMax: "Used / Max",
  contextSource: "Usage source",
  contextMaxSource: "Max source",
  "source.live": "Live usage",
  "source.history": "History stats",
  "maxSource.live": "Agent reported max",
  "maxSource.configured": "Configured auto-compact window",
  "maxSource.history": "History stats",
  "maxSource.unknown": "Unknown",
  "contextLevel.normal": "Context usage is normal.",
  contextManagement: "Context Management",
  agentType: "Agent",
  configuredModel: "Configured model",
  autoCompactionThreshold: "Trigger threshold",
  autoCompaction: "Auto-compaction",
  configuredContextWindowMax: "Configured auto-compact window",
  runtimeContextWindowMax: "Runtime reported window",
  compactionSupport: "Compaction support",
  compactionStatus: "Compaction status",
  selectorModel: "ACP selector model",
  unknown: "Unknown",
  enabled: "Enabled",
  disabled: "Disabled",
  "configuredContextWindowMaxSourceState.agent_env": "Configured env",
  "compactionSupportState.native_managed": "Claude Code native",
  "compactionStatusState.idle": "Idle",
  tokenUsage: "Token Usage",
  input: "Input",
  output: "Output",
  cacheRead: "Cache Read",
  cacheWrite: "Cache Write",
  total: "Total",
}

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => messages[key] ?? key,
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))

function fixtureManagement() {
  return {
    ...DEFAULT_CONTEXT_MANAGEMENT,
    configuredModel: "gpt-5.6-terra",
    configuredModelSource: "agent_env" as const,
    runtimeModel: "opus",
    configuredContextWindowMaxTokens: 1_000_000,
    contextWindowMaxSource: "agent_env" as const,
    runtimeContextWindowMaxTokens: 1_000_000,
    autoCompactionEnabled: true,
    autoCompactionThreshold: 35,
    compactionSupport: "native_managed" as const,
    compactionStatus: "idle" as const,
    runtimeConfig: {
      agentType: "claude_code" as const,
      connectionId: "connection",
      sessionId: "session",
      agentConfig: {
        configured_model: "gpt-5.6-terra",
        configured_model_source: "agent_env" as const,
        configured_context_window_max_tokens: 1_000_000,
        context_window_max_source: "agent_env" as const,
        auto_compaction_enabled: true,
        auto_compaction_threshold: 35,
        native_auto_compact_window: 1_000_000,
      },
      selectorModel: "opus",
    },
  }
}

describe("StatusBarTokens", () => {
  it("builds configured-window context values in the 0..100 percent domain", () => {
    const view = buildStatusBarTokenViewModel({
      agentType: "claude_code",
      liveUsed: 274_000,
      liveSize: 1_000_000,
      historicalUsed: null,
      historicalSize: null,
      historicalPercent: null,
      management: fixtureManagement(),
      usage: null,
      totalTokens: null,
    })

    expect(view.contextPercent).toBeCloseTo(27.4)
    expect(view.contextUsed).toBe(274_000)
    expect(view.contextMax).toBe(1_000_000)
    expect(view.contextUsageSource).toBe("live")
    expect(view.contextMaxSource).toBe("configured")
  })

  it("renders the acceptance fixture, including 35% without double scaling", () => {
    h.connection = {
      agentType: "claude_code",
      usage: { used: 274_000, size: 1_000_000 },
      contextManagement: fixtureManagement(),
    }
    h.sessionStats = {
      total_usage: {
        input_tokens: 12_000,
        output_tokens: 3_000,
        cache_read_input_tokens: 4_000,
        cache_creation_input_tokens: 1_000,
      },
      total_tokens: 20_000,
      total_duration_ms: 1_000,
    }

    render(<StatusBarTokens />)

    expect(screen.getAllByText("27.4%").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("274K / 1M")).toBeInTheDocument()
    expect(screen.getByText("35%")).toBeInTheDocument()
    expect(screen.queryByText("3500%")).not.toBeInTheDocument()
    expect(screen.getByText("1M · Configured env")).toBeInTheDocument()
    expect(screen.getByText("Claude Code native")).toBeInTheDocument()
    expect(screen.getByText("Idle")).toBeInTheDocument()
    expect(screen.getByText("opus")).toBeInTheDocument()
    expect(screen.getByText("12K")).toBeInTheDocument()
    expect(screen.getByText("20K")).toBeInTheDocument()
  })
})
