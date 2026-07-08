import { beforeEach, describe, expect, it } from "vitest"

import {
  getSavedPrefsForConnect,
  saveConfigPreference,
} from "./selector-prefs-storage"

const STORAGE_KEY = "codeg:selector-prefs"

describe("selector prefs storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("persists boolean config preferences as connect-safe strings", () => {
    saveConfigPreference("claude_code", "enable_thinking", true)
    expect(getSavedPrefsForConnect("claude_code").configValues).toEqual({
      enable_thinking: "true",
    })

    saveConfigPreference("claude_code", "enable_thinking", false)
    expect(getSavedPrefsForConnect("claude_code").configValues).toEqual({
      enable_thinking: "false",
    })
  })

  it("normalizes legacy boolean config values and drops invalid strings", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        claude_code: {
          configValues: {
            enable_thinking: true,
            model: "null",
            effort: "sonnet",
            empty: "   ",
          },
        },
      })
    )

    expect(getSavedPrefsForConnect("claude_code").configValues).toEqual({
      enable_thinking: "true",
      effort: "sonnet",
    })
  })
})
