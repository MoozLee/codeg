"use client"

import { Fragment } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import type { ModelOptionGroup } from "@/lib/model-config-groups"
import { isValidSessionConfigValue } from "@/lib/acp-context-management"
import type {
  SessionConfigOptionInfo,
  SessionConfigSelectOptionInfo,
} from "@/lib/types"

interface SessionConfigSelectorProps {
  option: SessionConfigOptionInfo
  onSelect: (configId: string, value: string | boolean) => void
  /**
   * Frontend-derived grouping for the model picker (split on the `provider/`
   * prefix). When provided, it overrides the option's own (flat) value list;
   * a group with `name === null` renders its options with no header. `null`
   * means "no grouping" — fall back to server groups, else the flat list.
   */
  derivedGroups?: ModelOptionGroup[] | null
}

function validOptions(
  options: SessionConfigSelectOptionInfo[]
): SessionConfigSelectOptionInfo[] {
  return options.filter((option) => isValidSessionConfigValue(option.value))
}

function validGroups(groups: ModelOptionGroup[]): ModelOptionGroup[] {
  return groups
    .map((group) => ({ ...group, options: validOptions(group.options) }))
    .filter((group) => group.options.length > 0)
}

export function InlineSessionConfigSelector({
  option,
  onSelect,
  derivedGroups,
}: SessionConfigSelectorProps) {
  if (option.kind.type === "boolean") {
    return (
      <label
        className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground"
        title={option.description ?? option.name}
      >
        <span className="max-w-[10rem] truncate">{option.name}</span>
        <Switch
          checked={option.kind.current_value}
          onCheckedChange={(checked) => onSelect(option.id, checked)}
          aria-label={option.name}
          className="scale-75"
        />
      </label>
    )
  }

  // Unified group list rendered in the dropdown body. Derived (model) groups
  // win; otherwise server-provided groups; otherwise `null` → flat options.
  // `name === null` is a headerless bucket (the leading prefix-less models).
  const renderGroups: ModelOptionGroup[] | null =
    derivedGroups && derivedGroups.length > 0
      ? validGroups(derivedGroups)
      : option.kind.groups.length > 0
        ? validGroups(
            option.kind.groups.map((group) => ({
              key: group.group,
              name: group.name,
              options: group.options,
            }))
          )
        : null
  const filteredOptions = validOptions(option.kind.options)

  // Resolve the trigger label against the *rendered* options so the selected
  // model shows its prefix-stripped name (its provider is already implied by
  // the group it sits in) rather than repeating `provider/`.
  const renderedOptions = renderGroups
    ? renderGroups.flatMap((group) => group.options)
    : filteredOptions
  const currentValueIsValid = isValidSessionConfigValue(
    option.kind.current_value
  )
  const selected = currentValueIsValid
    ? renderedOptions.find((item) => item.value === option.kind.current_value)
    : undefined
  const currentLabel =
    selected?.name ?? (currentValueIsValid ? option.kind.current_value : "")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          title={option.name}
          aria-label={
            currentLabel ? `${option.name}: ${currentLabel}` : option.name
          }
          className="min-w-0 gap-0.5 px-1 text-muted-foreground"
        >
          <span className="max-w-[10rem] truncate">{currentLabel}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="min-w-72 overflow-y-auto"
        style={{
          maxWidth: "min(20rem, calc(100vw - 1rem))",
          maxHeight:
            "min(60vh, var(--radix-dropdown-menu-content-available-height))",
        }}
      >
        <DropdownMenuRadioGroup
          value={currentValueIsValid ? option.kind.current_value : ""}
          onValueChange={(value) => onSelect(option.id, value)}
        >
          {renderGroups
            ? renderGroups.map((group, index) => (
                <Fragment key={group.key}>
                  {index > 0 && <DropdownMenuSeparator />}
                  {group.name !== null && (
                    <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
                  )}
                  {group.options.map((item) => (
                    <DropdownMenuRadioItem
                      key={`${group.key}-${item.value}`}
                      value={item.value}
                      title={item.name}
                    >
                      <DropdownRadioItemContent
                        label={item.name}
                        description={item.description}
                      />
                    </DropdownMenuRadioItem>
                  ))}
                </Fragment>
              ))
            : filteredOptions.map((item) => (
                <DropdownMenuRadioItem
                  key={item.value}
                  value={item.value}
                  title={item.name}
                >
                  <DropdownRadioItemContent
                    label={item.name}
                    description={item.description}
                  />
                </DropdownMenuRadioItem>
              ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
