import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  agentsUpdatedHandlers: new Set<(payload: unknown) => void>(),
  acpDetectAgentLocalVersion: vi.fn(),
  acpGetAgentConfig: vi.fn(),
  acpGetAgentStatus: vi.fn(),
  acpListAgents: vi.fn(),
  acpPreflight: vi.fn(),
  listModelProviders: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/lib/api", () => ({
  acpClearBinaryCache: vi.fn(),
  acpDeleteCustomAgent: vi.fn(),
  acpDetectAgentLocalVersion: mocks.acpDetectAgentLocalVersion,
  acpDownloadAgentBinary: vi.fn(),
  acpGetAgentConfig: mocks.acpGetAgentConfig,
  acpGetAgentStatus: mocks.acpGetAgentStatus,
  acpInstallUvTool: vi.fn(),
  acpListAgents: mocks.acpListAgents,
  acpOpenHermesSetupTerminal: vi.fn(),
  acpPrepareNpxAgent: vi.fn(),
  acpPreflight: mocks.acpPreflight,
  acpReorderAgents: vi.fn(),
  acpRevealHermesHome: vi.fn(),
  acpUninstallAgent: vi.fn(),
  acpUpdateAgentConfig: vi.fn(),
  acpUpdateAgentEnv: vi.fn(),
  acpUpdateHermesConfig: vi.fn(),
  codexPollDeviceCode: vi.fn(),
  codexRequestDeviceCode: vi.fn(),
  listModelProviders: mocks.listModelProviders,
  opencodeProviderCatalog: vi.fn(),
}))

vi.mock("@/lib/platform", () => ({
  isDesktop: () => false,
  openUrl: vi.fn(),
  subscribe: mocks.subscribe,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import { AcpAgentSettings } from "./acp-agent-settings"
import enMessages from "@/i18n/messages/en.json"
import type {
  AcpAgentEditableConfig,
  AcpAgentInfo,
  AgentType,
} from "@/lib/types"

const HERMES_YAML_PLACEHOLDER = /moonshotai\/kimi-k2/

function agent(
  agentType: AgentType,
  name: string,
  sortOrder: number
): AcpAgentInfo {
  return {
    agent_type: agentType,
    skills_capable: true,
    registry_id: agentType,
    registry_version: null,
    name,
    description: "",
    available: true,
    distribution_type: "npx",
    is_acp_adapter: false,
    custom_source: null,
    enabled: true,
    sort_order: sortOrder,
    installed_version: null,
    model_provider_id: null,
    uses_custom_skill_dir: false,
    icon_url: null,
  }
}

function editableConfig(
  overrides: Partial<AcpAgentEditableConfig> = {}
): AcpAgentEditableConfig {
  return {
    env: {},
    config_json: null,
    config_file_path: null,
    opencode_auth_json: null,
    codex_auth_json: null,
    codex_config_toml: null,
    codex_model_catalog: null,
    codex_sandbox_settings: null,
    cline_secrets_json: null,
    hermes_config_yaml: null,
    grok_config_toml: null,
    grok_settings: null,
    cursor_cli_config_json: null,
    cursor_settings: null,
    ...overrides,
  }
}

function renderSettings() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AcpAgentSettings />
    </NextIntlClientProvider>
  )
}

function clickAgent(agentType: AgentType) {
  const item = document.querySelector<HTMLElement>(
    `[data-agent-type="${agentType}"]`
  )
  if (!item) throw new Error(`Missing ${agentType} settings row`)
  fireEvent.click(item)
}

async function findHermesYamlEditor() {
  await screen.findByText(enMessages.AcpAgentSettings.hermes.advancedTitle)
  return waitFor(() => {
    const editor = screen
      .getAllByPlaceholderText(HERMES_YAML_PLACEHOLDER)
      .find((element) => element instanceof HTMLTextAreaElement)
    if (!editor) throw new Error("Missing Hermes raw config editor")
    return editor
  })
}

describe("AcpAgentSettings selected configuration lifecycle", () => {
  beforeEach(() => {
    mocks.agentsUpdatedHandlers.clear()
    mocks.acpListAgents.mockResolvedValue([
      agent("hermes", "Hermes", 0),
      agent("grok", "Grok", 1),
    ])
    mocks.listModelProviders.mockResolvedValue([])
    mocks.acpPreflight.mockRejectedValue(new Error("not needed"))
    mocks.acpDetectAgentLocalVersion.mockRejectedValue(new Error("not needed"))
    mocks.acpGetAgentStatus.mockRejectedValue(new Error("not needed"))
    mocks.subscribe.mockImplementation(
      async (event: string, handler: (payload: unknown) => void) => {
        if (event === "app://acp-agents-updated") {
          mocks.agentsUpdatedHandlers.add(handler)
        }
        return () => mocks.agentsUpdatedHandlers.delete(handler)
      }
    )
    HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("replaces an edited selected draft after an external configuration update", async () => {
    let latestHermesConfig = editableConfig({
      hermes_config_yaml: "model:\n  default: initial",
    })
    mocks.acpGetAgentConfig.mockImplementation(async (agentType: AgentType) => {
      if (agentType === "hermes") return latestHermesConfig
      return editableConfig({ grok_config_toml: "model = 'grok'" })
    })

    renderSettings()

    const textarea = await findHermesYamlEditor()
    await waitFor(() => {
      expect(textarea).toHaveValue("model:\n  default: initial")
      expect(mocks.agentsUpdatedHandlers.size).toBeGreaterThan(0)
    })

    fireEvent.change(textarea, {
      target: { value: "model:\n  default: stale-local-edit" },
    })
    expect(textarea).toHaveValue("model:\n  default: stale-local-edit")

    latestHermesConfig = editableConfig({
      hermes_config_yaml: "model:\n  default: external-update",
    })
    await act(async () => {
      for (const handler of [...mocks.agentsUpdatedHandlers]) handler({})
    })

    expect(await findHermesYamlEditor()).toHaveValue(
      "model:\n  default: external-update"
    )
  })

  it("does not display an old visited agent detail while a fresh detail reloads", async () => {
    let resolveHermes: ((config: AcpAgentEditableConfig) => void) | null = null
    let deferHermes = false
    mocks.acpGetAgentConfig.mockImplementation((agentType: AgentType) => {
      if (agentType === "hermes" && deferHermes) {
        return new Promise<AcpAgentEditableConfig>((resolve) => {
          resolveHermes = resolve
        })
      }
      if (agentType === "hermes") {
        return Promise.resolve(
          editableConfig({
            hermes_config_yaml: "model:\n  default: old-detail",
          })
        )
      }
      return Promise.resolve(
        editableConfig({ grok_config_toml: "model = 'grok'" })
      )
    })

    renderSettings()
    const initialEditor = await findHermesYamlEditor()
    expect(initialEditor).toHaveValue("model:\n  default: old-detail")

    clickAgent("grok")
    await waitFor(() => {
      expect(mocks.acpGetAgentConfig).toHaveBeenLastCalledWith("grok")
    })

    deferHermes = true
    clickAgent("hermes")
    await waitFor(() => {
      expect(mocks.acpGetAgentConfig).toHaveBeenLastCalledWith("hermes")
    })
    expect(
      screen.queryByDisplayValue("model:\n  default: old-detail")
    ).not.toBeInTheDocument()

    await act(async () => {
      resolveHermes?.(
        editableConfig({
          hermes_config_yaml: "model:\n  default: fresh-detail",
        })
      )
    })
    expect(await findHermesYamlEditor()).toHaveValue(
      "model:\n  default: fresh-detail"
    )
  })
})
