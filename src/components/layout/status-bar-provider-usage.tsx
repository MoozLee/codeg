"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Loader2, RefreshCw, Wallet } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  listProviderUsageConfigs,
  listProviderUsageResults,
  queryProviderUsage,
} from "@/lib/api"
import { subscribe } from "@/lib/platform"
import type {
  ProviderUsageAmount,
  ProviderUsageConfigInfo,
  ProviderUsageResult,
  ProviderUsageSubscriptionItem,
  QueryKind,
} from "@/lib/types"

const PROVIDER_USAGE_UPDATED_EVENT = "provider_usage:updated"
const WINDOW_FOCUS_REFRESH_THROTTLE_MS = 30_000

interface RelativeLabels {
  justNow: string
  minutes: (n: number) => string
  hours: (n: number) => string
  days: (n: number) => string
}

function formatRelative(iso: string, labels: RelativeLabels): string {
  if (!iso) return "--"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "--"
  const diff = Date.now() - then
  if (diff < 0) return labels.justNow
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return labels.justNow
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return labels.minutes(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return labels.hours(hours)
  const days = Math.floor(hours / 24)
  return labels.days(days)
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "--"
  if (!Number.isFinite(value)) return "--"
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return value.toFixed(2)
}

/**
 * Clamp floating-point dust around zero to a clean 0. Aggregating balance +
 * subscription frequently produces values like `-0.02` (used = 0.02, total =
 * 0 on the subscription side), which renders as a confusing red negative
 * remaining; anything within half a cent of zero is treated as zero. The
 * backend applies the same tolerance to top-level aggregates, but we apply
 * it on every displayed amount (including per-kind slices and detail rows)
 * so the UI never surfaces dust values to the user.
 */
function clampZero(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return value ?? null
  return Math.abs(value) < 0.005 ? 0 : value
}

/**
 * Remaining-percentage tier → Tailwind color token. Status bar uses these so
 * a healthy balance reads as calm green, running-low as amber, and near-empty
 * as red; falls back to `text-foreground` when no percentage is computable.
 */
function availableToneClass(percent: number | null): string {
  if (percent == null) return "text-foreground"
  if (percent > 50) return "text-emerald-600 dark:text-emerald-400"
  if (percent >= 20) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

export function StatusBarProviderUsage() {
  const t = useTranslations("StatusBarProviderUsage")
  const [configs, setConfigs] = useState<ProviderUsageConfigInfo[]>([])
  const [results, setResults] = useState<Record<number, ProviderUsageResult>>(
    {}
  )
  const [refreshing, setRefreshing] = useState(false)
  const lastManualRefreshRef = useRef(0)
  const lastFocusRefreshRef = useRef(0)

  const reloadAll = useCallback(async () => {
    try {
      const [rows, cached] = await Promise.all([
        listProviderUsageConfigs(),
        listProviderUsageResults(),
      ])
      setConfigs(rows)
      const map: Record<number, ProviderUsageResult> = {}
      for (const r of cached) map[r.config_id] = r
      setResults(map)
    } catch {
      // Silent: status bar stays hidden / stale on failure.
    }
  }, [])

  useEffect(() => {
    reloadAll()
  }, [reloadAll])

  useEffect(() => {
    let unsub: (() => void) | null = null
    let cancelled = false
    subscribe<ProviderUsageResult>(PROVIDER_USAGE_UPDATED_EVENT, (payload) => {
      if (!payload) return
      setResults((prev) => ({ ...prev, [payload.config_id]: payload }))
    })
      .then((fn) => {
        if (cancelled) {
          fn()
          return
        }
        unsub = fn
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (unsub) unsub()
    }
  }, [])

  // Window focus throttled refresh fallback.
  useEffect(() => {
    if (typeof window === "undefined") return
    const handler = () => {
      const now = Date.now()
      if (
        now - lastFocusRefreshRef.current <
        WINDOW_FOCUS_REFRESH_THROTTLE_MS
      ) {
        return
      }
      lastFocusRefreshRef.current = now
      reloadAll()
    }
    window.addEventListener("focus", handler)
    return () => {
      window.removeEventListener("focus", handler)
    }
  }, [reloadAll])

  const activeConfig = useMemo<ProviderUsageConfigInfo | null>(() => {
    const enabled = configs.filter((c) => c.enabled)
    if (enabled.length === 0) return null
    const pinned = enabled.find((c) => c.show_in_status_bar)
    return pinned ?? null
  }, [configs])

  const result = activeConfig ? (results[activeConfig.id] ?? null) : null

  const handleRefresh = useCallback(
    async (e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation()
        e.preventDefault()
      }
      if (!activeConfig) return
      const now = Date.now()
      if (now - lastManualRefreshRef.current < 1000) return
      lastManualRefreshRef.current = now
      setRefreshing(true)
      try {
        const updated = await queryProviderUsage(activeConfig.id)
        setResults((prev) => ({ ...prev, [updated.config_id]: updated }))
      } catch {
        // Silent: toast surface is in the settings page.
      } finally {
        setRefreshing(false)
      }
    },
    [activeConfig]
  )

  if (!activeConfig) return null

  const success = result?.success ?? false
  const used = clampZero(result?.used ?? null)
  const remaining = clampZero(result?.remaining ?? null)
  const unit = result?.unit ?? "USD"
  const percentDenominator = (() => {
    if (!success) return null
    const balanceRemaining = clampZero(result?.balance?.remaining ?? null)
    const subscriptionTotal = clampZero(result?.subscription?.total ?? null)
    const values = [balanceRemaining, subscriptionTotal].filter(
      (value): value is number => value != null && Number.isFinite(value)
    )
    if (values.length === 0) return null
    return values.reduce((sum, value) => sum + value, 0)
  })()

  const availablePercent =
    success &&
    remaining != null &&
    percentDenominator != null &&
    percentDenominator > 0
      ? (remaining / percentDenominator) * 100
      : null

  // When the aggregate has no usable totals, fall back to neutral foreground
  // so a single-kind config (or an in-flight cold-load) doesn't read as
  // "healthy green" without any actual quota math behind the color.
  const hasToneSignal = success && availablePercent != null
  const availableToneClassName = success
    ? hasToneSignal
      ? availableToneClass(availablePercent)
      : "text-foreground"
    : "text-red-500"

  const primaryText = (() => {
    if (!result) return "--"
    if (!success) return t("errorCompact")
    if (remaining != null) {
      return `$${formatNumber(remaining)}`
    }
    return "--"
  })()

  const updatedText = result
    ? formatRelative(result.updated_at, {
        justNow: t("justNow"),
        minutes: (n) => t("minutesAgo", { n }),
        hours: (n) => t("hoursAgo", { n }),
        days: (n) => t("daysAgo", { n }),
      })
    : null

  const activeKinds = (activeConfig.query_kinds ?? []) as QueryKind[]
  const kindLabel = activeKinds
    .map((k) =>
      k === "newapi_subscription" ? t("kindSubscription") : t("kindBalance")
    )
    .join(" · ")

  const formatPercent = (pct: number): string =>
    `${pct.toFixed(pct >= 10 ? 0 : 1)}%`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={
            success
              ? "flex items-center gap-1 transition-colors hover:text-foreground"
              : "flex items-center gap-1 text-red-500 transition-colors hover:text-red-400"
          }
          title={activeConfig.name}
        >
          {success ? (
            <Wallet className="size-3.5" />
          ) : (
            <AlertCircle className="size-3.5" />
          )}
          <span className={`tabular-nums ${availableToneClassName}`}>
            {primaryText}
          </span>
          {updatedText && (
            <span className="text-muted-foreground">· {updatedText}</span>
          )}
          {refreshing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw
              className="size-3 opacity-60 hover:opacity-100"
              onClick={handleRefresh}
              role="button"
              aria-label={t("refresh")}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 gap-2 p-3 text-xs">
        <div className="space-y-2">
          {/* Summary block: configuration name + aggregated available quota */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs font-medium">
              <span className="truncate">{activeConfig.name}</span>
              <span className="text-muted-foreground shrink-0">
                {kindLabel}
              </span>
            </div>
            {result ? (
              result.success ? (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t("availableQuota")}
                    </span>
                    <span
                      className={`text-base font-semibold tabular-nums ${availableToneClassName}`}
                    >
                      {remaining != null ? `$${formatNumber(remaining)}` : "--"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t("historicalConsumption")}</span>
                    <span className="tabular-nums">
                      {used != null ? `${formatNumber(used)} ${unit}` : "--"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    {availablePercent != null ? (
                      <>
                        <span>{t("availableQuotaPct")}</span>
                        <span
                          className={`tabular-nums ${availableToneClassName}`}
                        >
                          {formatPercent(availablePercent)}
                        </span>
                      </>
                    ) : (
                      <span />
                    )}
                    {updatedText && <span>{updatedText}</span>}
                  </div>
                </>
              ) : (
                <div className="text-xs text-red-500 leading-snug">
                  {result.message ?? t("errorUnknown")}
                </div>
              )
            ) : (
              <div className="text-xs text-muted-foreground">{t("noData")}</div>
            )}
          </div>

          {/* Per-kind sections — only render when the backend returned a
              per-kind slice. Single-kind configs continue to show only one
              section so the popover doesn't add empty noise. */}
          {result?.balance && (
            <BalanceKindSection
              title={t("balanceSection")}
              amount={result.balance}
              unit={unit}
              labels={{
                remaining: t("balance"),
                errorUnknown: t("errorUnknown"),
              }}
            />
          )}
          {result?.subscription && (
            <UsageKindSection
              title={t("subscriptionSection")}
              amount={result.subscription}
              unit={unit}
              labels={{
                used: t("used"),
                remaining: t("availableQuota"),
                total: t("total"),
                errorUnknown: t("errorUnknown"),
              }}
              subscriptionItemsTitle={t("subscriptionItems")}
            />
          )}

          <div className="pt-1">
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? t("refreshing") : t("refresh")}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface BalanceKindSectionLabels {
  remaining: string
  errorUnknown: string
}

interface UsageKindSectionLabels extends BalanceKindSectionLabels {
  used: string
  total: string
}

interface BalanceKindSectionProps {
  title: string
  amount: ProviderUsageAmount
  unit: string
  labels: BalanceKindSectionLabels
}

interface UsageKindSectionProps {
  title: string
  amount: ProviderUsageAmount
  unit: string
  labels: UsageKindSectionLabels
  subscriptionItemsTitle?: string
}

function BalanceKindSection({
  title,
  amount,
  unit,
  labels,
}: BalanceKindSectionProps) {
  const remaining = clampZero(amount.remaining ?? null)
  const message = amount.message ?? null

  return (
    <div className="border-t border-border pt-2 space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {amount.success ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{labels.remaining}</span>
          <span className="tabular-nums">
            {remaining != null ? `${formatNumber(remaining)} ${unit}` : "--"}
          </span>
        </div>
      ) : (
        <div className="text-xs text-red-500 leading-snug">
          {message ?? labels.errorUnknown}
        </div>
      )}
    </div>
  )
}

function UsageKindSection({
  title,
  amount,
  unit,
  labels,
  subscriptionItemsTitle,
}: UsageKindSectionProps) {
  const used = clampZero(amount.used ?? null)
  const remaining = clampZero(amount.remaining ?? null)
  const total = clampZero(amount.total ?? null)
  const items: ProviderUsageSubscriptionItem[] = amount.subscriptions ?? []
  const message = amount.message ?? null

  return (
    <div className="border-t border-border pt-2 space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {amount.success ? (
        <>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{labels.used}</span>
            <span className="tabular-nums">
              {used != null ? `${formatNumber(used)} ${unit}` : "--"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{labels.total}</span>
            <span className="tabular-nums">
              {total != null ? `${formatNumber(total)} ${unit}` : "--"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{labels.remaining}</span>
            <span className="tabular-nums">
              {remaining != null ? `${formatNumber(remaining)} ${unit}` : "--"}
            </span>
          </div>
          {subscriptionItemsTitle && items.length > 0 && (
            <div className="pt-1 space-y-0.5">
              <div className="text-[11px] font-medium text-muted-foreground">
                {subscriptionItemsTitle}
              </div>
              {items.map((s, idx) => {
                const itemUsed = clampZero(s.used ?? null)
                const itemTotal = clampZero(s.total ?? null)
                const itemRemaining = clampZero(s.remaining ?? null)
                return (
                  <div
                    key={`${s.plan_name}-${idx}`}
                    className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="truncate">{s.plan_name}</span>
                    <span className="tabular-nums shrink-0">
                      {itemUsed != null && itemTotal != null
                        ? `${formatNumber(itemUsed)} / ${formatNumber(itemTotal)} ${unit}`
                        : itemRemaining != null
                          ? `${formatNumber(itemRemaining)} ${unit}`
                          : "--"}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-red-500 leading-snug">
          {message ?? labels.errorUnknown}
        </div>
      )}
    </div>
  )
}
