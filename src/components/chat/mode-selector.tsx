"use client"

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import type { SessionModeInfo } from "@/lib/types"

interface ModeSelectorProps {
  modes: SessionModeInfo[]
  selectedModeId: string | null
  onSelect: (modeId: string) => void
  label: string
}

export function ModeSelector({
  modes,
  selectedModeId,
  onSelect,
  label,
}: ModeSelectorProps) {
  const selected = modes.find((mode) => mode.id === selectedModeId)
  const currentLabel = selected?.name ?? selectedModeId ?? ""
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        title={selected?.description ?? selected?.name ?? label}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <span className="max-w-[10rem] shrink-0 truncate text-xs text-muted-foreground">
          {currentLabel}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[60vh] min-w-72 max-w-xs overflow-y-auto">
        <DropdownMenuRadioGroup
          value={selectedModeId ?? ""}
          onValueChange={onSelect}
        >
          {modes.map((mode) => (
            <DropdownMenuRadioItem key={mode.id} value={mode.id}>
              <DropdownRadioItemContent
                label={mode.name}
                description={mode.description}
              />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
