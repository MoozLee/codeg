import { describe, expect, it } from "vitest"

import { inferLiveToolName } from "./tool-call-normalization"

describe("inferLiveToolName meta.claudeCode.toolName override", () => {
  it("returns memory_recall for synthesized recall events without rawInput", () => {
    // Mirrors what claude-agent-acp >=0.37 emits for memory recall:
    // title carries the human-readable count, kind borrows the file-read
    // category, rawInput is null. Only the meta field knows the real name.
    expect(
      inferLiveToolName({
        title: "Recalled 3 memories",
        kind: "read",
        rawInput: null,
        meta: { claudeCode: { toolName: "memory_recall" } },
      })
    ).toBe("memory_recall")

    expect(
      inferLiveToolName({
        title: "Recalled synthesized memory",
        kind: "read",
        rawInput: null,
        meta: { claudeCode: { toolName: "memory_recall" } },
      })
    ).toBe("memory_recall")
  })

  it("falls back to title-based inference when no meta is provided", () => {
    // Pre-0.37 traffic / non-Claude agents have no meta.claudeCode.toolName.
    // The legacy paths must keep working.
    expect(
      inferLiveToolName({
        title: "Recalled 3 memories",
        kind: "read",
        rawInput: null,
      })
    ).not.toBe("memory_recall")
  })

  it("preserves sub-agent detection when rawInput carries subagent_type", () => {
    // Regression guard: meta.claudeCode.toolName="Task" must NOT override
    // input-shape detection. Otherwise Claude Code's Task tool stops
    // routing into the AgentToolCallPart card and child tool calls no
    // longer nest under their parent.
    expect(
      inferLiveToolName({
        title: "Implement feature X",
        kind: "other",
        rawInput: JSON.stringify({
          subagent_type: "general-purpose",
          prompt: "Do the thing",
        }),
        meta: { claudeCode: { toolName: "Task" } },
      })
    ).toBe("agent")
  })

  it("ignores meta when claudeCode is missing or malformed", () => {
    expect(
      inferLiveToolName({
        title: "Recalled 3 memories",
        kind: "read",
        rawInput: null,
        meta: null,
      })
    ).not.toBe("memory_recall")

    expect(
      inferLiveToolName({
        title: "Recalled 3 memories",
        kind: "read",
        rawInput: null,
        meta: { somethingElse: { toolName: "memory_recall" } },
      })
    ).not.toBe("memory_recall")

    expect(
      inferLiveToolName({
        title: "Recalled 3 memories",
        kind: "read",
        rawInput: null,
        meta: { claudeCode: { toolName: "   " } },
      })
    ).not.toBe("memory_recall")
  })
})
