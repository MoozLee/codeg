"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Pencil, Plus, RefreshCw, Receipt, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  deleteProviderUsageConfig,
  listProviderUsageConfigs,
  listProviderUsageResults,
  queryProviderUsage,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { subscribe } from "@/lib/platform"
import type { ProviderUsageConfigInfo, ProviderUsageResult } from "@/lib/types"
import { AddProviderUsageQueryDialog } from "./add-provider-usage-query-dialog"
import { EditProviderUsageQueryDialog } from "./edit-provider-usage-query-dialog"

const PROVIDER_USAGE_UPDATED_EVENT = "provider_usage:updated"

export function ProviderUsageQuerySettings() {
  const t = useTranslations("ProviderUsageQuerySettings")
  const [configs, setConfigs] = useState<ProviderUsageConfigInfo[]>([])
  const [results, setResults] = useState<Record<number, ProviderUsageResult>>(
    {}
  )
  const [loading, setLoading] = useState(true)
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set())
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ProviderUsageConfigInfo | null>(
    null
  )
  const [deleteTarget, setDeleteTarget] =
    useState<ProviderUsageConfigInfo | null>(null)

  const loadConfigs = useCallback(async () => {
    try {
      const [rows, cachedResults] = await Promise.all([
        listProviderUsageConfigs(),
        listProviderUsageResults(),
      ])
      setConfigs(rows)
      const resultMap: Record<number, ProviderUsageResult> = {}
      for (const r of cachedResults) {
        resultMap[r.config_id] = r
      }
      setResults(resultMap)
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfigs().catch(console.error)
  }, [loadConfigs])

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

  const handleRefresh = useCallback(
    async (config: ProviderUsageConfigInfo) => {
      setRefreshingIds((prev) => {
        const next = new Set(prev)
        next.add(config.id)
        return next
      })
      try {
        const result = await queryProviderUsage(config.id)
        setResults((prev) => ({ ...prev, [result.config_id]: result }))
        if (result.success) {
          toast.success(t("refreshSuccess"))
        } else {
          toast.error(result.message ?? t("refreshFailed"))
        }
      } catch (err) {
        toast.error(toErrorMessage(err))
      } finally {
        setRefreshingIds((prev) => {
          const next = new Set(prev)
          next.delete(config.id)
          return next
        })
      }
    },
    [t]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteProviderUsageConfig(deleteTarget.id)
      toast.success(t("deleteSuccess"))
      setDeleteTarget(null)
      await loadConfigs()
    } catch (err) {
      toast.error(toErrorMessage(err))
    }
  }, [deleteTarget, loadConfigs, t])

  const summary = useMemo(() => {
    return configs.map((c) => ({
      config: c,
      result: results[c.id] ?? null,
    }))
  }, [configs, results])

  return (
    <ScrollArea className="h-full">
      <section className="space-y-3 px-3 pt-3 md:px-4 md:pt-4">
        <div>
          <h1 className="text-sm font-semibold">{t("sectionTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("sectionDescription")}
          </p>
        </div>
      </section>

      <section className="mt-4 space-y-2 px-3 pb-3 md:px-4 md:pb-4">
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("addConfig")}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : summary.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Receipt className="h-8 w-8 mb-2 opacity-40" />
            <span className="text-xs">{t("noConfigs")}</span>
          </div>
        ) : (
          <div className="space-y-2">
            {summary.map(({ config, result }) => {
              const refreshing = refreshingIds.has(config.id)
              const queryLabel =
                config.query_kind === "newapi_subscription"
                  ? t("queryKindSubscription")
                  : t("queryKindBalance")
              return (
                <div
                  key={config.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {config.name}
                      </div>
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 shrink-0"
                      >
                        {queryLabel}
                      </Badge>
                      {config.enabled ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 shrink-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        >
                          {t("enabledShort")}
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 shrink-0 opacity-60"
                        >
                          {t("disabledShort")}
                        </Badge>
                      )}
                      {config.show_in_status_bar && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 shrink-0 bg-primary/10 text-primary"
                        >
                          {t("statusBarShort")}
                        </Badge>
                      )}
                      {!config.has_token && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 shrink-0 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        >
                          {t("noToken")}
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground font-mono">
                      {config.base_url}
                    </div>
                    {result && (
                      <div className="text-xs text-muted-foreground">
                        {result.success ? (
                          <span>
                            {result.plan_name && (
                              <span className="mr-2">{result.plan_name}</span>
                            )}
                            {result.used != null && result.total != null
                              ? `${result.used.toFixed(2)} / ${result.total.toFixed(2)} ${result.unit}`
                              : result.remaining != null
                                ? `${result.remaining.toFixed(2)} ${result.unit}`
                                : "--"}
                          </span>
                        ) : (
                          <span className="text-red-500">
                            {result.message ?? t("refreshFailed")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={refreshing}
                      onClick={() => handleRefresh(config)}
                      title={t("refresh")}
                    >
                      {refreshing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setEditTarget(config)}
                      title={t("edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => setDeleteTarget(config)}
                      title={t("delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <AddProviderUsageQueryDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onConfigAdded={loadConfigs}
      />

      <EditProviderUsageQueryDialog
        config={editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
        onConfigUpdated={loadConfigs}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmMessage", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollArea>
  )
}
