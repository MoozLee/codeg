"use client"

import { useCallback, useSyncExternalStore } from "react"
import { Coins } from "lucide-react"
import { useTranslations } from "next-intl"
import { useSessionStats } from "@/contexts/session-stats-context"
import { useConnectionStore } from "@/contexts/acp-connections-context"
import { AGENT_LABELS, type AgentType, type TurnUsage } from "@/lib/types"
import {
  formatNormalizedPercent,
  type ContextManagementState,
} from "@/lib/acp-context-management"
import { formatTokenCount } from "@/lib/token-format"
import { formatContextWindowPercent } from "@/lib/context-window"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const ICON_RADIUS = 6
const ICON_CENTER = 8
const ICON_VIEWBOX = 16
const ICON_CIRCUMFERENCE = 2 * Math.PI * ICON_RADIUS

type ContextUsageSource = "live" | "history"
type ContextMaxDisplaySource = "configured" | "live" | "history" | "unknown"
type ContextHealth = "unknown" | "normal" | "high" | "critical"

interface StatusBarTokenViewModelInput {
  agentType: AgentType | null
  liveUsed: number | null
  liveSize: number | null
  historicalUsed: number | null
  historicalSize: number | null
  historicalPercent: number | null
  management: ContextManagementState | null
  usage: TurnUsage | null
  totalTokens: number | null
}

export interface StatusBarTokenViewModel {
  contextUsed: number | null
  contextMax: number | null
  contextPercent: number | null
  contextUsageSource: ContextUsageSource
  contextMaxSource: ContextMaxDisplaySource
  contextHealth: ContextHealth
  runtimeContextMax: number | null
  runtimeContextWindowClamped: boolean
  tokenRows: Array<{
    key: "input" | "output" | "cacheRead" | "cacheWrite" | "total"
    value: number
  }>
  agentType: AgentType | null
  management: ContextManagementState | null
}

export function buildStatusBarTokenViewModel(
  input: StatusBarTokenViewModelInput
): StatusBarTokenViewModel {
  const liveContextUsed =
    input.liveUsed != null && input.liveUsed > 0 ? input.liveUsed : null
  const liveContextMax =
    input.liveSize != null && input.liveSize > 0 ? input.liveSize : null
  const configuredContextMax =
    input.management?.configuredContextWindowMaxTokens ?? null
  const contextUsed = liveContextUsed ?? input.historicalUsed
  const contextMax =
    configuredContextMax ?? liveContextMax ?? input.historicalSize
  const rawPercent =
    contextUsed != null && contextMax != null && contextMax > 0
      ? (contextUsed / contextMax) * 100
      : input.historicalPercent
  const contextPercent =
    rawPercent == null ? null : Math.max(0, Math.min(100, rawPercent))
  const runtimeContextMax =
    input.management?.runtimeContextWindowMaxTokens ?? liveContextMax
  const runtimeContextWindowClamped =
    configuredContextMax != null &&
    runtimeContextMax != null &&
    runtimeContextMax < configuredContextMax
  const contextHealth: ContextHealth =
    contextPercent == null
      ? "unknown"
      : contextPercent > 90
        ? "critical"
        : contextPercent >= 70
          ? "high"
          : "normal"
  const contextMaxSource: ContextMaxDisplaySource =
    configuredContextMax != null
      ? "configured"
      : liveContextMax != null
        ? "live"
        : input.historicalSize != null
          ? "history"
          : "unknown"

  const tokenRows: StatusBarTokenViewModel["tokenRows"] = []
  if (input.usage) {
    tokenRows.push(
      { key: "input", value: input.usage.input_tokens },
      { key: "output", value: input.usage.output_tokens },
      { key: "cacheRead", value: input.usage.cache_read_input_tokens },
      { key: "cacheWrite", value: input.usage.cache_creation_input_tokens }
    )
  }
  const fallbackTotal = input.usage
    ? input.usage.input_tokens +
      input.usage.output_tokens +
      input.usage.cache_creation_input_tokens +
      input.usage.cache_read_input_tokens
    : null
  const total = input.totalTokens ?? fallbackTotal
  if (total != null) tokenRows.push({ key: "total", value: total })

  return {
    contextUsed,
    contextMax,
    contextPercent,
    contextUsageSource: liveContextUsed != null ? "live" : "history",
    contextMaxSource,
    contextHealth,
    runtimeContextMax,
    runtimeContextWindowClamped,
    tokenRows,
    agentType: input.agentType,
    management: input.management,
  }
}

function DetailRow({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] items-start gap-3 text-xs leading-tight text-muted-foreground">
      <span className="min-w-0">{label}</span>
      <span className="min-w-0 truncate text-right tabular-nums" title={title}>
        {value}
      </span>
    </div>
  )
}

export function StatusBarTokens() {
  const t = useTranslations("Folder.statusBar.tokens")
  const store = useConnectionStore()
  const { sessionStats } = useSessionStats()
  const usage = sessionStats?.total_usage ?? null

  const subscribeActiveKey = useCallback(
    (callback: () => void) => store.subscribeActiveKey(callback),
    [store]
  )
  const getActiveKey = useCallback(() => store.getActiveKey(), [store])
  const activeKey = useSyncExternalStore(
    subscribeActiveKey,
    getActiveKey,
    getActiveKey
  )

  const subscribeConnection = useCallback(
    (callback: () => void) => {
      if (!activeKey) return () => {}
      return store.subscribeKey(activeKey, callback)
    },
    [activeKey, store]
  )
  const getConnectionSnapshot = useCallback(
    () => (activeKey ? store.getConnection(activeKey) : undefined),
    [activeKey, store]
  )
  const activeConnection = useSyncExternalStore(
    subscribeConnection,
    getConnectionSnapshot,
    getConnectionSnapshot
  )

  const view = buildStatusBarTokenViewModel({
    agentType: activeConnection?.agentType ?? null,
    liveUsed: activeConnection?.usage?.used ?? null,
    liveSize: activeConnection?.usage?.size ?? null,
    historicalUsed: sessionStats?.context_window_used_tokens ?? null,
    historicalSize: sessionStats?.context_window_max_tokens ?? null,
    historicalPercent: sessionStats?.context_window_usage_percent ?? null,
    management: activeConnection?.contextManagement ?? null,
    usage,
    totalTokens: sessionStats?.total_tokens ?? null,
  })

  const hasContext = view.contextPercent != null
  const hasManagement = view.management != null
  const hasTokenSection = view.tokenRows.length > 0
  if (!hasContext && !hasManagement && !hasTokenSection) return null

  const dashOffset = ICON_CIRCUMFERENCE * (1 - (view.contextPercent ?? 0) / 100)
  const configuredContextMax =
    view.management?.configuredContextWindowMaxTokens ?? null
  const configuredContextMaxSource =
    view.management?.contextWindowMaxSource ?? null
  const configuredModel = view.management?.configuredModel ?? null
  const selectorModel = view.management?.runtimeConfig?.selectorModel ?? null
  const compactionSupport = view.management?.compactionSupport ?? "unknown"
  const compactionStatus = view.management?.compactionStatus ?? "idle"
  const lastCompactionError = view.management?.lastCompactionError ?? null
  const autoCompactionEnabled = view.management?.autoCompactionEnabled ?? null
  const autoCompactionThreshold =
    view.management?.autoCompactionThreshold ?? null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1 transition-colors hover:text-foreground ${
            view.contextHealth === "critical"
              ? "text-destructive"
              : view.contextHealth === "high"
                ? "text-amber-600 dark:text-amber-400"
                : ""
          }`}
        >
          {hasContext ? (
            <>
              <svg
                aria-label={t("contextWindowUsageAria")}
                className="size-3.5"
                viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
              >
                <circle
                  cx={ICON_CENTER}
                  cy={ICON_CENTER}
                  r={ICON_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  opacity="0.25"
                />
                <circle
                  cx={ICON_CENTER}
                  cy={ICON_CENTER}
                  r={ICON_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeDasharray={`${ICON_CIRCUMFERENCE} ${ICON_CIRCUMFERENCE}`}
                  strokeDashoffset={dashOffset}
                  style={{
                    transformOrigin: "center",
                    transform: "rotate(-90deg)",
                  }}
                  opacity="0.75"
                />
              </svg>
              <span>{formatContextWindowPercent(view.contextPercent)}</span>
            </>
          ) : (
            <>
              <Coins className="size-3.5" />
              <span>
                {formatTokenCount(
                  view.tokenRows.find((row) => row.key === "total")?.value ?? 0
                )}
              </span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 gap-2 p-3 text-xs">
        {hasContext ? (
          <section
            className={`space-y-1.5 ${
              hasManagement || hasTokenSection
                ? "border-b border-border pb-2"
                : ""
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-xs font-medium">
              <span>{t("contextWindow")}</span>
              <span className="shrink-0 tabular-nums">
                {formatContextWindowPercent(view.contextPercent)}
              </span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`absolute inset-y-0 left-0 ${
                  view.contextHealth === "critical"
                    ? "bg-destructive"
                    : view.contextHealth === "high"
                      ? "bg-amber-500"
                      : "bg-foreground/70"
                }`}
                style={{ width: `${view.contextPercent ?? 0}%` }}
              />
            </div>
            <DetailRow
              label={t("usedMax")}
              value={
                view.contextUsed == null || view.contextMax == null
                  ? "--"
                  : `${formatTokenCount(view.contextUsed)} / ${formatTokenCount(view.contextMax)}`
              }
            />
            <DetailRow
              label={t("contextSource")}
              value={t(`source.${view.contextUsageSource}`)}
            />
            <DetailRow
              label={t("contextMaxSource")}
              value={t(`maxSource.${view.contextMaxSource}`)}
            />
            <p
              className={`text-xs leading-snug ${
                view.contextHealth === "critical"
                  ? "text-destructive"
                  : view.contextHealth === "high"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
              }`}
            >
              {t(`contextLevel.${view.contextHealth}`)}
            </p>
          </section>
        ) : null}

        {hasManagement ? (
          <section
            className={`space-y-1.5 ${
              hasTokenSection ? "border-b border-border pb-2" : ""
            }`}
          >
            <div className="text-xs font-medium">{t("contextManagement")}</div>
            <DetailRow
              label={t("agentType")}
              value={view.agentType ? AGENT_LABELS[view.agentType] : "--"}
            />
            <DetailRow
              label={t("configuredModel")}
              value={configuredModel ?? t("unknown")}
              title={configuredModel ?? undefined}
            />
            <DetailRow
              label={t("autoCompactionThreshold")}
              value={
                autoCompactionThreshold == null
                  ? t("unknown")
                  : formatNormalizedPercent(autoCompactionThreshold)
              }
            />
            <DetailRow
              label={t("autoCompaction")}
              value={
                autoCompactionEnabled == null
                  ? t("unknown")
                  : autoCompactionEnabled
                    ? t("enabled")
                    : t("disabled")
              }
            />
            <DetailRow
              label={t("configuredContextWindowMax")}
              value={
                configuredContextMax == null
                  ? t("unknown")
                  : `${formatTokenCount(configuredContextMax)} · ${
                      configuredContextMaxSource
                        ? t(
                            `configuredContextWindowMaxSourceState.${configuredContextMaxSource}`
                          )
                        : t("unknown")
                    }`
              }
              title={
                configuredContextMax == null
                  ? undefined
                  : configuredContextMax.toLocaleString()
              }
            />
            <DetailRow
              label={t("runtimeContextWindowMax")}
              value={
                view.runtimeContextMax == null
                  ? t("unknown")
                  : formatTokenCount(view.runtimeContextMax)
              }
              title={view.runtimeContextMax?.toLocaleString()}
            />
            {view.runtimeContextWindowClamped ? (
              <p className="text-xs leading-snug text-amber-600 dark:text-amber-400">
                {t("contextWindowClampedWarning", {
                  configured: formatTokenCount(configuredContextMax ?? 0),
                  runtime: formatTokenCount(view.runtimeContextMax ?? 0),
                })}
              </p>
            ) : null}
            <DetailRow
              label={t("compactionSupport")}
              value={t(`compactionSupportState.${compactionSupport}`)}
            />
            <DetailRow
              label={t("compactionStatus")}
              value={t(`compactionStatusState.${compactionStatus}`)}
            />
            {lastCompactionError ? (
              <p
                className="break-words text-xs leading-snug text-destructive"
                title={lastCompactionError}
              >
                {lastCompactionError}
              </p>
            ) : null}
            <DetailRow
              label={t("selectorModel")}
              value={selectorModel ?? t("unknown")}
              title={selectorModel ?? undefined}
            />
          </section>
        ) : null}

        {hasTokenSection ? (
          <section className="space-y-0.5">
            <div className="text-xs font-medium">{t("tokenUsage")}</div>
            {view.tokenRows.map((row) => (
              <div
                key={row.key}
                className={`flex items-center justify-between gap-3 py-0.5 text-xs leading-none ${
                  row.key === "total"
                    ? "mt-1 border-t border-border pt-1 font-medium"
                    : "text-muted-foreground"
                }`}
              >
                <span>{t(row.key)}</span>
                <span className="shrink-0 tabular-nums">
                  {formatTokenCount(row.value)}
                </span>
              </div>
            ))}
          </section>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
