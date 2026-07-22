import { beforeEach, describe, expect, it } from "vitest"

import {
  getSavedPrefsForConnect,
  saveConfigPreference,
} from "./selector-prefs-storage"

const STORAGE_KEY = "codeg:selector-prefs"

describe("selector preference storage", () => {
  beforeEach(() => localStorage.clear())

  it("drops null, empty, and non-string persisted values", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        codex: {
          modeId: " ",
          configValues: {
            mode: null,
            model: "opus",
            empty: " ",
            fake: "undefined",
            rawBoolean: true,
            object: { value: "bad" },
          },
        },
      })
    )

    expect(getSavedPrefsForConnect("codex")).toEqual({
      modeId: null,
      configValues: { model: "opus" },
    })
  })

  it("serializes boolean config values for backend replay", () => {
    saveConfigPreference("claude_code", "auto_compact", true)
    expect(getSavedPrefsForConnect("claude_code").configValues).toEqual({
      auto_compact: "true",
    })
  })
})
