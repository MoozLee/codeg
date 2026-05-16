"use client"

import { useCallback, useSyncExternalStore } from "react"
import { Coins } from "lucide-react"
import { useTranslations } from "next-intl"
import { useSessionStats } from "@/contexts/session-stats-context"
import { useConnectionStore } from "@/contexts/acp-connections-context"
import { formatTokenCount } from "@/lib/token-format"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const ICON_RADIUS = 6
const ICON_CENTER = 8
const ICON_VIEWBOX = 16
const ICON_CIRCUMFERENCE = 2 * Math.PI * ICON_RADIUS

function formatPercent(percent: number | null): string {
  if (percent == null) return "--"
  return `${percent.toFixed(1)}%`
}

export function StatusBarTokens() {
  const t = useTranslations("Folder.statusBar.tokens")
  const store = useConnectionStore()
  const { sessionStats } = useSessionStats()
  const usage = sessionStats?.total_usage

  const subscribeActiveKey = useCallback(
    (cb: () => void) => store.subscribeActiveKey(cb),
    [store]
  )
  const getActiveKey = useCallback(() => store.getActiveKey(), [store])
  const activeKey = useSyncExternalStore(
    subscribeActiveKey,
    getActiveKey,
    getActiveKey
  )

  const subscribeConn = useCallback(
    (cb: () => void) => {
      if (!activeKey) return () => {}
      return store.subscribeKey(activeKey, cb)
    },
    [store, activeKey]
  )
  const getConnSnapshot = useCallback(
    () => (activeKey ? store.getConnection(activeKey) : undefined),
    [store, activeKey]
  )
  const activeConn = useSyncExternalStore(
    subscribeConn,
    getConnSnapshot,
    getConnSnapshot
  )

  const contextManagement = activeConn?.contextManagement ?? null
  const configuredContextMax =
    contextManagement?.configuredContextWindowMaxTokens ?? null
  const configuredContextMaxSource =
    contextManagement?.contextWindowMaxSource ?? null
  const rawLiveUsed = activeConn?.usage?.used ?? null
  const rawLiveSize = activeConn?.usage?.size ?? null
  // Treat live used=0 as "no data" so we fall back to sessionStats —
  // Claude Code sends used=0 for synthetic local commands (/context etc.)
  const liveContextUsed =
    rawLiveUsed != null && rawLiveUsed > 0 ? rawLiveUsed : null
  const liveContextMax =
    rawLiveSize != null && rawLiveSize > 0 ? rawLiveSize : null
  const historicalContextUsed = sessionStats?.context_window_used_tokens ?? null
  const historicalContextMax = sessionStats?.context_window_max_tokens ?? null
  const hasActiveConnectionConfiguredContextMax =
    activeConn != null && configuredContextMax != null

  const contextUsed = liveContextUsed ?? historicalContextUsed
  const runtimeContextMax =
    contextManagement?.runtimeContextWindowMaxTokens ?? liveContextMax
  const runtimeContextWindowClamped =
    configuredContextMax != null &&
    runtimeContextMax != null &&
    runtimeContextMax < configuredContextMax
  const contextMax = hasActiveConnectionConfiguredContextMax
    ? configuredContextMax
    : (liveContextMax ?? historicalContextMax)
  const contextPercentRaw =
    (contextUsed != null && contextMax != null && contextMax > 0
      ? (contextUsed / contextMax) * 100
      : sessionStats?.context_window_usage_percent) ?? null
  const contextPercent =
    contextPercentRaw == null
      ? null
      : Math.max(0, Math.min(100, contextPercentRaw))
  const contextSource = liveContextUsed != null ? "live" : "history"
  const contextMaxSource = hasActiveConnectionConfiguredContextMax
    ? "configured"
    : liveContextMax != null
      ? "live"
      : historicalContextMax != null
        ? "history"
        : "unknown"
  const contextLevel =
    contextPercent == null
      ? "unknown"
      : contextPercent > 90
        ? "critical"
        : contextPercent >= 70
          ? "high"
          : "normal"
  const hasContext = contextPercent != null
  const hasUsage = usage != null
  const fallbackTotal = hasUsage
    ? usage.input_tokens +
      usage.output_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens
    : null
  const total = sessionStats?.total_tokens ?? fallbackTotal

  const dashOffset = ICON_CIRCUMFERENCE * (1 - (contextPercent ?? 0) / 100)

  const rows: {
    key: "input" | "output" | "cacheRead" | "cacheWrite" | "total"
    value: number
  }[] = []
  if (hasUsage) {
    rows.push(
      { key: "input", value: usage.input_tokens },
      { key: "output", value: usage.output_tokens },
      { key: "cacheRead", value: usage.cache_read_input_tokens },
      { key: "cacheWrite", value: usage.cache_creation_input_tokens }
    )
  }
  if (total != null) {
    rows.push({ key: "total", value: total })
  }

  const hasTokenSection = rows.length > 0
  const compactionSupport = contextManagement?.compactionSupport ?? "unknown"
  const compactionStatus = contextManagement?.compactionStatus ?? "idle"
  const lastCompactionError = contextManagement?.lastCompactionError ?? null
  const autoCompactionEnabled = contextManagement?.autoCompactionEnabled
  const autoCompactionThreshold = contextManagement?.autoCompactionThreshold
  const configuredModel = contextManagement?.configuredModel ?? null
  const runtimeConfig = contextManagement?.runtimeConfig ?? null
  const selectorModel = runtimeConfig?.selectorModel ?? null

  if (!hasContext && !hasTokenSection && !contextManagement) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1 transition-colors hover:text-foreground ${
            contextLevel === "critical"
              ? "text-destructive"
              : contextLevel === "high"
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
              <span>{formatPercent(contextPercent)}</span>
            </>
          ) : (
            <>
              <Coins className="size-3.5" />
              <span>{formatTokenCount(total ?? 0)}</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 gap-2 p-3 text-xs">
        {hasContext ? (
          <div
            className={`space-y-1 ${
              hasUsage ? "mb-0.5 border-b border-border pb-0.5" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium whitespace-nowrap">
              <span>{t("contextWindow")}</span>
              <span className="tabular-nums shrink-0">
                {formatPercent(contextPercent)}
              </span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`absolute inset-y-0 left-0 ${
                  contextLevel === "critical"
                    ? "bg-destructive"
                    : contextLevel === "high"
                      ? "bg-amber-500"
                      : "bg-foreground/70"
                }`}
                style={{ width: `${contextPercent ?? 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs leading-none text-muted-foreground">
              <span>{t("usedMax")}</span>
              <span className="tabular-nums">
                {contextUsed == null || contextMax == null
                  ? "--"
                  : `${formatTokenCount(contextUsed)} / ${formatTokenCount(contextMax)}`}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs leading-none text-muted-foreground">
              <span>{t("contextSource")}</span>
              <span>{t(`source.${contextSource}`)}</span>
            </div>
            <div className="flex items-center justify-between text-xs leading-none text-muted-foreground">
              <span>{t("contextMaxSource")}</span>
              <span>{t(`maxSource.${contextMaxSource}`)}</span>
            </div>
            <div
              className={`text-xs leading-snug ${
                contextLevel === "critical"
                  ? "text-destructive"
                  : contextLevel === "high"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
              }`}
            >
              {t(`contextLevel.${contextLevel}`)}
            </div>
          </div>
        ) : null}
        {contextManagement ? (
          <div
            className={`space-y-1 ${
              hasContext || hasTokenSection
                ? "mb-0.5 border-b border-border pb-0.5"
                : ""
            }`}
          >
            <div className="text-xs leading-none font-medium">
              {t("contextManagement")}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("agentType")}</span>
              <span>
                {activeConn?.agentType ?? runtimeConfig?.agentType ?? "--"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("configuredModel")}</span>
              <span
                className="max-w-36 truncate text-right"
                title={configuredModel ?? undefined}
              >
                {configuredModel ?? t("unknown")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("autoCompactionThreshold")}</span>
              <span>
                {autoCompactionThreshold == null
                  ? t("unknown")
                  : formatPercent(autoCompactionThreshold)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("autoCompaction")}</span>
              <span>
                {autoCompactionEnabled == null
                  ? t("unknown")
                  : autoCompactionEnabled
                    ? t("enabled")
                    : t("disabled")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("configuredContextWindowMax")}</span>
              <span
                className="max-w-36 truncate text-right"
                title={
                  configuredContextMax == null
                    ? undefined
                    : `${configuredContextMax.toLocaleString()} · ${
                        configuredContextMaxSource
                          ? t(
                              `configuredContextWindowMaxSourceState.${configuredContextMaxSource}`
                            )
                          : t("unknown")
                      }`
                }
              >
                {configuredContextMax == null
                  ? t("unknown")
                  : `${formatTokenCount(configuredContextMax)} · ${
                      configuredContextMaxSource
                        ? t(
                            `configuredContextWindowMaxSourceState.${configuredContextMaxSource}`
                          )
                        : t("unknown")
                    }`}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("runtimeContextWindowMax")}</span>
              <span
                className="max-w-36 truncate text-right"
                title={runtimeContextMax?.toLocaleString()}
              >
                {runtimeContextMax == null
                  ? t("unknown")
                  : formatTokenCount(runtimeContextMax)}
              </span>
            </div>
            {runtimeContextWindowClamped ? (
              <div className="text-xs leading-snug text-amber-600 dark:text-amber-400">
                {t("contextWindowClampedWarning", {
                  configured: formatTokenCount(configuredContextMax ?? 0),
                  runtime: formatTokenCount(runtimeContextMax ?? 0),
                })}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("compactionSupport")}</span>
              <span>{t(`compactionSupportState.${compactionSupport}`)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("compactionStatus")}</span>
              <span
                className="max-w-36 truncate text-right"
                title={lastCompactionError ?? undefined}
              >
                {lastCompactionError ??
                  t(`compactionStatusState.${compactionStatus}`)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("selectorModel")}</span>
              <span
                className="max-w-36 truncate text-right"
                title={selectorModel ?? undefined}
              >
                {selectorModel ?? t("unknown")}
              </span>
            </div>
          </div>
        ) : null}
        {hasTokenSection ? (
          <>
            <div className="mb-0 mt-0.5 text-xs leading-none font-medium">
              {t("tokenUsage")}
            </div>
            <div className="space-y-0">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={`flex items-center justify-between py-0.5 text-xs leading-none ${
                    row.key === "total"
                      ? "mt-0.5 border-t border-border pt-0.5 font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  <span>{t(row.key)}</span>
                  <span className="tabular-nums">
                    {formatTokenCount(row.value)}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
