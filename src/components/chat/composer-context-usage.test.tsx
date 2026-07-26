import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ComposerContextUsage,
  buildComposerContextUsageViewModel,
} from "./composer-context-usage"
import { DEFAULT_CONTEXT_MANAGEMENT } from "@/lib/acp-context-management"
import type { ContextManagementState } from "@/lib/acp-context-management"
import type {
  AgentType,
  SessionStats,
  SessionUsageUpdateInfo,
} from "@/lib/types"

const h = vi.hoisted(() => ({
  connections: new Map<
    string,
    {
      agentType: AgentType
      usage: SessionUsageUpdateInfo
      contextManagement: ContextManagementState
    }
  >(),
  sessionStats: new Map<number, SessionStats | null>(),
  tabs: [] as Array<{
    id: string
    kind: "conversation"
    conversationId: number | null
    runtimeConversationId: number | null
  }>,
}))

vi.mock("@/contexts/acp-connections-context", () => ({
  useConnectionStore: () => ({
    getConnection: (tabId: string) => h.connections.get(tabId),
    subscribeKey: () => () => {},
  }),
}))

vi.mock("@/contexts/tab-context", () => ({
  useTabStore: (selector: (state: { tabs: typeof h.tabs }) => unknown) =>
    selector({ tabs: h.tabs }),
}))

vi.mock("@/stores/conversation-runtime-store", () => ({
  useConversationRuntimeStore: (
    selector: (state: {
      byConversationId: Map<number, { sessionStats: SessionStats | null }>
    }) => unknown
  ) =>
    selector({
      byConversationId: new Map(
        [...h.sessionStats.entries()].map(([id, sessionStats]) => [
          id,
          { sessionStats },
        ])
      ),
    }),
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
  "contextLevel.high": "Context usage is high.",
  "contextLevel.critical": "Context usage is critical.",
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

function fixtureManagement(): ContextManagementState {
  return {
    ...DEFAULT_CONTEXT_MANAGEMENT,
    configuredModel: "gpt-5.6-terra",
    configuredModelSource: "agent_env",
    runtimeModel: "opus",
    configuredContextWindowMaxTokens: 1_000_000,
    contextWindowMaxSource: "agent_env",
    runtimeContextWindowMaxTokens: 1_000_000,
    autoCompactionEnabled: true,
    autoCompactionThreshold: 35,
    compactionSupport: "native_managed",
    compactionStatus: "idle",
    runtimeConfig: {
      agentType: "claude_code",
      connectionId: "connection",
      sessionId: "session",
      agentConfig: {
        configured_model: "gpt-5.6-terra",
        configured_model_source: "agent_env",
        configured_context_window_max_tokens: 1_000_000,
        context_window_max_source: "agent_env",
        auto_compaction_enabled: true,
        auto_compaction_threshold: 35,
        native_auto_compact_window: 1_000_000,
      },
      selectorModel: "opus",
    },
  }
}

function seedTab(tabId: string, runtimeConversationId: number) {
  h.tabs.push({
    id: tabId,
    kind: "conversation",
    conversationId: runtimeConversationId,
    runtimeConversationId,
  })
}

beforeEach(() => {
  h.connections.clear()
  h.sessionStats.clear()
  h.tabs.splice(0)
})

describe("ComposerContextUsage", () => {
  it("builds configured-window context values in the 0..100 percent domain", () => {
    const view = buildComposerContextUsageViewModel({
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

  it("renders context management for its own composer tab", () => {
    seedTab("tab-a", 71)
    h.connections.set("tab-a", {
      agentType: "claude_code",
      usage: { used: 274_000, size: 1_000_000 },
      contextManagement: fixtureManagement(),
    })
    h.sessionStats.set(71, {
      total_usage: {
        input_tokens: 12_000,
        output_tokens: 3_000,
        cache_read_input_tokens: 4_000,
        cache_creation_input_tokens: 1_000,
      },
      total_tokens: 20_000,
      total_duration_ms: 1_000,
    })

    render(<ComposerContextUsage tabId="tab-a" />)

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

  it("keeps tiled composer context scoped to each tab", () => {
    seedTab("tab-a", 71)
    seedTab("tab-b", 72)
    h.connections.set("tab-a", {
      agentType: "claude_code",
      usage: { used: 100_000, size: 1_000_000 },
      contextManagement: fixtureManagement(),
    })
    h.connections.set("tab-b", {
      agentType: "claude_code",
      usage: { used: 900_000, size: 1_000_000 },
      contextManagement: fixtureManagement(),
    })

    render(
      <>
        <ComposerContextUsage tabId="tab-a" />
        <ComposerContextUsage tabId="tab-b" />
      </>
    )

    expect(screen.getAllByText("10.0%").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("90.0%").length).toBeGreaterThanOrEqual(1)
  })
})
