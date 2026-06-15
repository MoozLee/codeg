import type { ConnectionStatus, MessageTurn } from "@/lib/types"

function isTextOnlyUserTurn(turn: MessageTurn): boolean {
  return (
    turn.role === "user" && turn.blocks.every((block) => block.type === "text")
  )
}

function isOptimisticAnchorId(anchorId: string | null | undefined): boolean {
  return typeof anchorId === "string" && anchorId.startsWith("optimistic:")
}

export function findRetryEditableUserAnchorId(
  turns: MessageTurn[]
): string | null {
  let latestUserTurnIndex = -1
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].role === "user") {
      latestUserTurnIndex = index
      break
    }
  }
  if (latestUserTurnIndex < 0) return null

  const latestUserTurn = turns[latestUserTurnIndex]
  const anchorId = latestUserTurn.anchor_id ?? null
  if (!anchorId || !isTextOnlyUserTurn(latestUserTurn)) {
    return null
  }

  return anchorId
}

export function resolveRetryEditableUserAnchorId({
  turns,
  connStatus,
  showPromptingState,
  lastTurnStopReason,
}: {
  turns: MessageTurn[]
  connStatus: ConnectionStatus | null | undefined
  showPromptingState: boolean
  lastTurnStopReason?: string | null
}): string | null {
  const candidate = findRetryEditableUserAnchorId(turns)
  if (!candidate) return null

  if (connStatus === "connected") {
    return showPromptingState ? null : candidate
  }
  if (
    connStatus === "prompting" &&
    lastTurnStopReason === "cancelled" &&
    isOptimisticAnchorId(candidate)
  ) {
    return candidate
  }
  return null
}
