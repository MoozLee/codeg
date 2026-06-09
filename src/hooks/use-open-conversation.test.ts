import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const apiMocks = vi.hoisted(() => ({
  focusConversationWindowIfOpen: vi.fn(async () => false),
  getSystemConversationOpenSettings: vi.fn(async () => ({
    defaultTarget: "tab",
    threshold: null,
  })),
  openWorkspaceWindow: vi.fn(async () => ({ focusedExisting: false })),
  registerConversationWindowOwner: vi.fn(async () => {}),
}))

const tabMocks = vi.hoisted(() => ({
  closeConversationTab: vi.fn(),
  openTab: vi.fn(),
  tabs: [] as Array<{
    folderId: number
    conversationId: number | null
    agentType: "claude_code"
  }>,
  tabPersistenceMode: "shared" as "shared" | "window-local",
}))

vi.mock("@/lib/api", () => apiMocks)

vi.mock("@/contexts/tab-context", () => ({
  useTabContext: () => tabMocks,
}))

describe("useOpenConversation", () => {
  beforeEach(() => {
    apiMocks.focusConversationWindowIfOpen.mockClear()
    apiMocks.focusConversationWindowIfOpen.mockResolvedValue(false)
    apiMocks.getSystemConversationOpenSettings.mockClear()
    apiMocks.getSystemConversationOpenSettings.mockResolvedValue({
      defaultTarget: "tab",
      threshold: null,
    })
    apiMocks.openWorkspaceWindow.mockClear()
    apiMocks.registerConversationWindowOwner.mockClear()
    tabMocks.closeConversationTab.mockClear()
    tabMocks.openTab.mockClear()
    tabMocks.tabs = []
    tabMocks.tabPersistenceMode = "shared"
  })

  it("moves explicit shared-window opens into a dedicated window", async () => {
    const { useOpenConversation } = await import("./use-open-conversation")
    const { result } = renderHook(() => useOpenConversation())

    await act(async () => {
      await result.current({
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
        explicitWindow: true,
      })
    })

    expect(apiMocks.openWorkspaceWindow).toHaveBeenCalledWith(
      {
        kind: "conversation",
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
      },
      "force-new-window"
    )
    expect(tabMocks.closeConversationTab).toHaveBeenCalledWith(
      1,
      11,
      "claude_code"
    )
  })

  it("moves explicit window-local opens into a dedicated window", async () => {
    tabMocks.tabPersistenceMode = "window-local"
    const { useOpenConversation } = await import("./use-open-conversation")
    const { result } = renderHook(() => useOpenConversation())

    await act(async () => {
      await result.current({
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
        explicitWindow: true,
      })
    })

    expect(apiMocks.openWorkspaceWindow).toHaveBeenCalledWith(
      {
        kind: "conversation",
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
      },
      "force-new-window"
    )
    expect(tabMocks.openTab).not.toHaveBeenCalled()
    expect(tabMocks.closeConversationTab).not.toHaveBeenCalled()
  })

  it("focuses an existing owner instead of opening a duplicate tab", async () => {
    apiMocks.focusConversationWindowIfOpen.mockResolvedValue(true)
    const { useOpenConversation } = await import("./use-open-conversation")
    const { result } = renderHook(() => useOpenConversation())

    await act(async () => {
      await result.current({
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
      })
    })

    expect(apiMocks.focusConversationWindowIfOpen).toHaveBeenCalledWith(11)
    expect(tabMocks.openTab).not.toHaveBeenCalled()
    expect(apiMocks.openWorkspaceWindow).not.toHaveBeenCalled()
  })

  it("focuses an existing owner before reselecting a stale shared tab", async () => {
    apiMocks.focusConversationWindowIfOpen.mockResolvedValue(true)
    tabMocks.tabs = [
      {
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
      },
    ]
    const { useOpenConversation } = await import("./use-open-conversation")
    const { result } = renderHook(() => useOpenConversation())

    await act(async () => {
      await result.current({
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
      })
    })

    expect(apiMocks.focusConversationWindowIfOpen).toHaveBeenCalledWith(11)
    expect(tabMocks.openTab).not.toHaveBeenCalled()
    expect(apiMocks.registerConversationWindowOwner).not.toHaveBeenCalled()
  })

  it("registers shared tab ownership when opening locally", async () => {
    const { useOpenConversation } = await import("./use-open-conversation")
    const { result } = renderHook(() => useOpenConversation())

    await act(async () => {
      await result.current({
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
      })
    })

    expect(tabMocks.openTab).toHaveBeenCalledWith(
      1,
      11,
      "claude_code",
      true,
      undefined
    )
    expect(apiMocks.registerConversationWindowOwner).toHaveBeenCalledWith(11)
  })

  it("keeps a stable callback while reading latest tab state", async () => {
    apiMocks.getSystemConversationOpenSettings.mockResolvedValue({
      defaultTarget: "window",
      threshold: null,
    })
    const { useOpenConversation } = await import("./use-open-conversation")
    const { result, rerender } = renderHook(() => useOpenConversation())
    const firstOpenConversation = result.current

    tabMocks.tabs = [
      {
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
      },
    ]
    rerender()

    expect(result.current).toBe(firstOpenConversation)

    await act(async () => {
      await result.current({
        folderId: 1,
        conversationId: 11,
        agentType: "claude_code",
      })
    })

    expect(apiMocks.openWorkspaceWindow).not.toHaveBeenCalled()
    expect(tabMocks.openTab).toHaveBeenCalledWith(
      1,
      11,
      "claude_code",
      true,
      undefined
    )
  })
})
