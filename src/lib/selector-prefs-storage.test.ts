import { beforeEach, describe, expect, it } from "vitest"

import {
  getSavedPrefsForConnect,
  saveConfigPreference,
} from "./selector-prefs-storage"

describe("selector preference storage", () => {
  beforeEach(() => localStorage.clear())

  it("serializes boolean config values for backend replay", () => {
    saveConfigPreference("claude_code", "auto_compact", true)

    expect(getSavedPrefsForConnect("claude_code").configValues).toEqual({
      auto_compact: "true",
    })
  })
})
