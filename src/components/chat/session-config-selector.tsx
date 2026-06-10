"use client"

import { Fragment } from "react"
import { useTranslations } from "next-intl"
import { Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import type { SessionConfigOptionInfo } from "@/lib/types"

interface SessionConfigSelectorProps {
  option: SessionConfigOptionInfo
  onSelect: (configId: string, value: string | boolean) => void
}

// Some upstream agents (e.g. Codex / Claude Code via sacp) emit option
// values that are the literal string "null" / "undefined" or pure
// whitespace — picking one of those would round-trip to the agent and
// be rejected with `Invalid value for config option ...`. Filter them
// out of the dropdown entirely and treat them as "no selection" when
// they happen to also be the advertised `current_value`.
function isInvalidConfigValueString(s: string): boolean {
  const trimmed = s.trim()
  if (trimmed.length === 0) return true
  const lower = trimmed.toLowerCase()
  return lower === "null" || lower === "undefined"
}

export function SessionConfigSelector({
  option,
  onSelect,
}: SessionConfigSelectorProps) {
  const t = useTranslations("Folder.chat.messageInput")

  if (option.kind.type === "boolean") {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger title={option.description ?? option.name}>
          <span className="min-w-0 flex-1 truncate font-medium">
            {option.name}
          </span>
          <span className="max-w-[10rem] shrink-0 truncate text-xs text-muted-foreground">
            {option.kind.current_value ? t("booleanOn") : t("booleanOff")}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-40">
          <DropdownMenuRadioGroup
            value={option.kind.current_value ? "true" : "false"}
            onValueChange={(value) => onSelect(option.id, value === "true")}
          >
            <DropdownMenuRadioItem value="true">
              {t("booleanOn")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="false">
              {t("booleanOff")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  const filteredGroups = option.kind.groups
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (item) => !isInvalidConfigValueString(item.value)
      ),
    }))
    .filter((group) => group.options.length > 0)
  const filteredOptions = option.kind.options.filter(
    (item) => !isInvalidConfigValueString(item.value)
  )
  const allOptions =
    filteredGroups.length > 0
      ? filteredGroups.flatMap((group) => group.options)
      : filteredOptions
  const currentValueIsInvalid = isInvalidConfigValueString(
    option.kind.current_value
  )
  const selected = currentValueIsInvalid
    ? undefined
    : allOptions.find((item) => item.value === option.kind.current_value)
  const currentLabel =
    selected?.name ?? (currentValueIsInvalid ? "" : option.kind.current_value)

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
      <DropdownMenuSubContent
        className="min-w-72 max-w-xs overflow-y-auto"
        style={{
          maxHeight:
            "min(60vh, var(--radix-dropdown-menu-content-available-height))",
        }}
      >
        <DropdownMenuRadioGroup
          value={currentValueIsInvalid ? "" : option.kind.current_value}
          onValueChange={(value) => onSelect(option.id, value)}
        >
          {filteredGroups.length > 0
            ? filteredGroups.map((group, index) => (
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
            : filteredOptions.map((item) => (
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

export function InlineSessionConfigSelector({
  option,
  onSelect,
}: SessionConfigSelectorProps) {
  const t = useTranslations("Folder.chat.messageInput")

  if (option.kind.type === "boolean") {
    return (
      <Button
        variant="ghost"
        size="sm"
        title={option.description ?? option.name}
        className="min-w-0 text-muted-foreground"
        onClick={() => onSelect(option.id, !option.kind.current_value)}
      >
        <span className="max-w-[10rem] truncate">{option.name}</span>
        <span className="text-xs">
          {option.kind.current_value ? t("booleanOn") : t("booleanOff")}
        </span>
        {option.kind.current_value ? (
          <Check className="size-4 shrink-0" />
        ) : null}
      </Button>
    )
  }

  const filteredGroups = option.kind.groups
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (item) => !isInvalidConfigValueString(item.value)
      ),
    }))
    .filter((group) => group.options.length > 0)
  const filteredOptions = option.kind.options.filter(
    (item) => !isInvalidConfigValueString(item.value)
  )
  const allOptions =
    filteredGroups.length > 0
      ? filteredGroups.flatMap((group) => group.options)
      : filteredOptions
  const currentValueIsInvalid = isInvalidConfigValueString(
    option.kind.current_value
  )
  const selected = currentValueIsInvalid
    ? undefined
    : allOptions.find((item) => item.value === option.kind.current_value)
  const currentLabel =
    selected?.name ?? (currentValueIsInvalid ? "" : option.kind.current_value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          title={option.description ?? option.name}
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
          value={currentValueIsInvalid ? "" : option.kind.current_value}
          onValueChange={(value) => onSelect(option.id, value)}
        >
          {filteredGroups.length > 0
            ? filteredGroups.map((group, index) => (
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
            : filteredOptions.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value}>
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
