import { describe, expect, it } from "vitest"

import {
  findRetryEditableUserAnchorId,
  resolveRetryEditableUserAnchorId,
} from "./retry-edit"
import type { MessageTurn, TurnRole } from "@/lib/types"

function turn(
  id: string,
  role: TurnRole,
  text: string,
  anchorId?: string | null
): MessageTurn {
  return {
    id,
    role,
    anchor_id: anchorId,
    blocks: [{ type: "text", text }],
    timestamp: "2026-06-15T00:00:00.000Z",
  }
}

describe("findRetryEditableUserAnchorId", () => {
  it("allows editing the last user message after a completed assistant reply", () => {
    const turns = [
      turn("u1", "user", "question", "anchor-1"),
      turn("a1", "assistant", "answer"),
    ]

    expect(findRetryEditableUserAnchorId(turns)).toBe("anchor-1")
    expect(
      resolveRetryEditableUserAnchorId({
        turns,
        connStatus: "connected",
        showPromptingState: false,
      })
    ).toBe("anchor-1")
  })

  it("selects the latest user turn in a multi-turn conversation", () => {
    const turns = [
      turn("u1", "user", "first", "anchor-1"),
      turn("a1", "assistant", "first answer"),
      turn("u2", "user", "second", "anchor-2"),
      turn("a2", "assistant", "second answer"),
    ]

    expect(findRetryEditableUserAnchorId(turns)).toBe("anchor-2")
  })

  it("allows editing an optimistic tail user turn after cancellation", () => {
    const turns = [
      turn("u1", "user", "previous", "anchor-1"),
      turn("a1", "assistant", "previous answer"),
      turn("u2", "user", "cancelled prompt", "optimistic:2"),
    ]

    expect(
      resolveRetryEditableUserAnchorId({
        turns,
        connStatus: "prompting",
        showPromptingState: true,
        lastTurnStopReason: "cancelled",
      })
    ).toBe("optimistic:2")
  })

  it("does not expose a persisted user turn while the assistant is still prompting", () => {
    const turns = [
      turn("u1", "user", "question", "anchor-1"),
      turn("a1", "assistant", "partial answer"),
    ]

    expect(
      resolveRetryEditableUserAnchorId({
        turns,
        connStatus: "prompting",
        showPromptingState: true,
        lastTurnStopReason: "cancelled",
      })
    ).toBeNull()
  })

  it("rejects user turns containing attachments", () => {
    const turns: MessageTurn[] = [
      {
        id: "u1",
        role: "user",
        anchor_id: "anchor-1",
        blocks: [
          {
            type: "image",
            data: "base64",
            mime_type: "image/png",
            uri: null,
          },
        ],
        timestamp: "2026-06-15T00:00:00.000Z",
      },
    ]

    expect(findRetryEditableUserAnchorId(turns)).toBeNull()
  })
})
