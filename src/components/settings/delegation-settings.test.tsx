import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  getDelegationSettings: vi.fn(),
  setDelegationSettings: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { DelegationSettingsSection } from "./delegation-settings"
import enMessages from "@/i18n/messages/en.json"
import {
  getDelegationSettings,
  setDelegationSettings,
  type DelegationSettings,
} from "@/lib/api"

const mockGetDelegationSettings = vi.mocked(getDelegationSettings)
const mockSetDelegationSettings = vi.mocked(setDelegationSettings)

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DelegationSettingsSection />
    </NextIntlClientProvider>
  )
}

function settings(
  overrides: Partial<DelegationSettings> = {}
): DelegationSettings {
  return {
    enabled: true,
    depth_limit: 2,
    default_timeout_seconds: 600,
    ...overrides,
  }
}

beforeEach(() => {
  mockGetDelegationSettings.mockReset()
  mockSetDelegationSettings.mockReset()
})

describe("DelegationSettingsSection", () => {
  it("allows zero as the minimum timeout and describes the no-timeout sentinel", async () => {
    mockGetDelegationSettings.mockResolvedValue(
      settings({ default_timeout_seconds: 0 })
    )

    renderWithIntl()

    const timeoutInput = await screen.findByLabelText(
      "Default timeout (seconds)"
    )
    expect(timeoutInput).toHaveAttribute("min", "0")
    expect(timeoutInput).toHaveValue(0)
    expect(
      screen.getByText(
        /0 disables the timeout; the child can run until it finishes/
      )
    ).toBeInTheDocument()
  })

  it("saves zero timeout without clamping it back to the old minimum", async () => {
    mockGetDelegationSettings.mockResolvedValue(settings())
    mockSetDelegationSettings.mockImplementation(async (next) => next)

    renderWithIntl()

    const timeoutInput = await screen.findByLabelText(
      "Default timeout (seconds)"
    )
    fireEvent.change(timeoutInput, { target: { value: "0" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(mockSetDelegationSettings).toHaveBeenCalledWith({
        enabled: true,
        depth_limit: 2,
        default_timeout_seconds: 0,
      })
    })
  })
})
