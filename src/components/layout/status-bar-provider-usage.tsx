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
import type { ProviderUsageConfigInfo, ProviderUsageResult } from "@/lib/types"

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
  const used = result?.used ?? null
  const total = result?.total ?? null
  const remaining = result?.remaining ?? null
  const unit = result?.unit ?? "USD"
  const planName = result?.plan_name ?? null

  const primaryText = (() => {
    if (!result) return "--"
    if (!success) return t("errorCompact")
    if (used != null && total != null) {
      return t("usedTotal", {
        used: formatNumber(used),
        total: formatNumber(total),
        unit,
      })
    }
    if (remaining != null) {
      return t("remainingOnly", {
        remaining: formatNumber(remaining),
        unit,
      })
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
          <span className="tabular-nums">{primaryText}</span>
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
      <PopoverContent side="top" align="end" className="w-72 gap-2 p-3 text-xs">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs font-medium">
            <span className="truncate">{activeConfig.name}</span>
            <span className="text-muted-foreground">
              {activeConfig.query_kind === "newapi_subscription"
                ? t("kindSubscription")
                : t("kindBalance")}
            </span>
          </div>
          {planName && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("planName")}</span>
              <span className="truncate">{planName}</span>
            </div>
          )}
          {result ? (
            result.success ? (
              <>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t("used")}</span>
                  <span className="tabular-nums">
                    {used != null ? `${formatNumber(used)} ${unit}` : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t("remaining")}</span>
                  <span className="tabular-nums">
                    {remaining != null
                      ? `${formatNumber(remaining)} ${unit}`
                      : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t("total")}</span>
                  <span className="tabular-nums">
                    {total != null ? `${formatNumber(total)} ${unit}` : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t("updatedAt")}</span>
                  <span>{updatedText}</span>
                </div>
                {result.expires_at && (
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t("expiresAt")}</span>
                    <span>{result.expires_at}</span>
                  </div>
                )}
                {result.subscriptions && result.subscriptions.length > 0 && (
                  <div className="pt-1 border-t border-border">
                    <div className="text-xs font-medium mb-1">
                      {t("subscriptions")}
                    </div>
                    <div className="space-y-0.5">
                      {result.subscriptions.map((s, idx) => (
                        <div
                          key={`${s.plan_name}-${idx}`}
                          className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                        >
                          <span className="truncate">{s.plan_name}</span>
                          <span className="tabular-nums shrink-0">
                            {s.used != null && s.total != null
                              ? `${formatNumber(s.used)} / ${formatNumber(s.total)} ${unit}`
                              : s.remaining != null
                                ? `${formatNumber(s.remaining)} ${unit}`
                                : "--"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-red-500 leading-snug">
                {result.message ?? t("errorUnknown")}
              </div>
            )
          ) : (
            <div className="text-xs text-muted-foreground">{t("noData")}</div>
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
