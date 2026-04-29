"use client"

import { Fragment } from "react"
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import type { SessionConfigOptionInfo } from "@/lib/types"

interface SessionConfigSelectorProps {
  option: SessionConfigOptionInfo
  onSelect: (configId: string, valueId: string) => void
}

export function SessionConfigSelector({
  option,
  onSelect,
}: SessionConfigSelectorProps) {
  if (option.kind.type !== "select") return null

  const allOptions =
    option.kind.groups.length > 0
      ? option.kind.groups.flatMap((group) => group.options)
      : option.kind.options
  const selected = allOptions.find(
    (item) => item.value === option.kind.current_value
  )
  const currentLabel = selected?.name ?? option.kind.current_value

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger title={option.description ?? option.name}>
        <span className="min-w-0 flex-1 truncate font-medium">
          {option.name}
        </span>
        <span className="max-w-[10rem] shrink-0 truncate text-xs text-muted-foreground">
          {currentLabel}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[60vh] min-w-72 max-w-xs overflow-y-auto">
        <DropdownMenuRadioGroup
          value={option.kind.current_value}
          onValueChange={(value) => onSelect(option.id, value)}
        >
          {option.kind.groups.length > 0
            ? option.kind.groups.map((group, index) => (
                <Fragment key={group.group}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
                  {group.options.map((item) => (
                    <DropdownMenuRadioItem
                      key={`${group.group}-${item.value}`}
                      value={item.value}
                    >
                      <DropdownRadioItemContent
                        label={item.name}
                        description={item.description}
                      />
                    </DropdownMenuRadioItem>
                  ))}
                </Fragment>
              ))
            : option.kind.options.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value}>
                  <DropdownRadioItemContent
                    label={item.name}
                    description={item.description}
                  />
                </DropdownMenuRadioItem>
              ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
