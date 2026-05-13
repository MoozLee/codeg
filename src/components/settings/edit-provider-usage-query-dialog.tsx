"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  deleteProviderUsageToken,
  saveProviderUsageToken,
  testProviderUsageConfig,
  updateProviderUsageConfig,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import type {
  ProviderUsageConfigInfo,
  ProviderUsageResult,
  QueryKind,
} from "@/lib/types"

interface EditProviderUsageQueryDialogProps {
  config: ProviderUsageConfigInfo | null
  onOpenChange: (open: boolean) => void
  onConfigUpdated: () => void
}

function validateBaseUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return "baseUrlRequired"
  if (!/^https:\/\//i.test(trimmed)) return "baseUrlHttpsRequired"
  return null
}

export function EditProviderUsageQueryDialog({
  config,
  onOpenChange,
  onConfigUpdated,
}: EditProviderUsageQueryDialogProps) {
  const t = useTranslations("ProviderUsageQuerySettings")
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<ProviderUsageResult | null>(null)

  const [name, setName] = useState("")
  const [queryKind, setQueryKind] = useState<QueryKind>("newapi_balance")
  const [baseUrl, setBaseUrl] = useState("")
  const [userId, setUserId] = useState("")
  const [token, setToken] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [showInStatusBar, setShowInStatusBar] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(5)
  const [timeout, setTimeout] = useState(10)

  useEffect(() => {
    if (config) {
      setName(config.name)
      setQueryKind((config.query_kind as QueryKind) ?? "newapi_balance")
      setBaseUrl(config.base_url)
      setUserId(config.user_id)
      setEnabled(config.enabled)
      setShowInStatusBar(config.show_in_status_bar)
      setRefreshInterval(config.refresh_interval_minutes)
      setTimeout(config.timeout_seconds)
      setToken("")
      setError(null)
      setTestResult(null)
    }
  }, [config])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setError(null)
        setTestResult(null)
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  const validate = useCallback((): string | null => {
    if (!name.trim()) return t("nameRequired")
    const urlErr = validateBaseUrl(baseUrl)
    if (urlErr === "baseUrlRequired") return t("baseUrlRequired")
    if (urlErr === "baseUrlHttpsRequired") return t("baseUrlHttpsRequired")
    if (!userId.trim()) return t("userIdRequired")
    if (timeout < 2 || timeout > 30) return t("timeoutRange")
    if (refreshInterval < 0) return t("refreshIntervalRange")
    if (!queryKind) return t("queryKindRequired")
    return null
  }, [name, baseUrl, userId, timeout, refreshInterval, queryKind, t])

  const handleTest = useCallback(async () => {
    if (!config) return
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const result = await testProviderUsageConfig({
        id: config.id,
        queryKind,
        baseUrl: baseUrl.trim(),
        userId: userId.trim(),
        timeoutSeconds: timeout,
        token: token.trim() ? token.trim() : null,
      })
      setTestResult(result)
      if (result.success) {
        toast.success(t("testSuccess"))
      } else {
        toast.error(result.message ?? t("testFailed"))
      }
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setTesting(false)
    }
  }, [config, validate, queryKind, baseUrl, userId, timeout, token, t])

  const handleSubmit = useCallback(async () => {
    if (!config) return
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    setError(null)
    try {
      await updateProviderUsageConfig({
        id: config.id,
        name: name.trim(),
        queryKind,
        baseUrl: baseUrl.trim(),
        userId: userId.trim(),
        enabled,
        showInStatusBar,
        refreshIntervalMinutes: refreshInterval,
        timeoutSeconds: timeout,
      })
      if (token.trim()) {
        await saveProviderUsageToken(config.id, token.trim())
      }
      toast.success(t("editSuccess"))
      handleOpenChange(false)
      onConfigUpdated()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [
    config,
    validate,
    name,
    queryKind,
    baseUrl,
    userId,
    enabled,
    showInStatusBar,
    refreshInterval,
    timeout,
    token,
    handleOpenChange,
    onConfigUpdated,
    t,
  ])

  const handleClearToken = useCallback(async () => {
    if (!config) return
    setLoading(true)
    setError(null)
    try {
      await deleteProviderUsageToken(config.id)
      toast.success(t("tokenCleared"))
      onConfigUpdated()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [config, onConfigUpdated, t])

  return (
    <Dialog open={!!config} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("editConfig")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <label htmlFor="edit-pu-name" className="text-xs font-medium">
              {t("name")}
            </label>
            <Input
              id="edit-pu-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t("queryKind")}</label>
            <Select
              value={queryKind}
              onValueChange={(v) => setQueryKind(v as QueryKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newapi_balance">
                  {t("queryKindBalance")}
                </SelectItem>
                <SelectItem value="newapi_subscription">
                  {t("queryKindSubscription")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-pu-baseurl" className="text-xs font-medium">
              {t("baseUrl")}
            </label>
            <Input
              id="edit-pu-baseurl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://your-newapi.example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-pu-userid" className="text-xs font-medium">
              {t("userId")}
            </label>
            <Input
              id="edit-pu-userid"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder={t("userIdPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-pu-token" className="text-xs font-medium">
              {t("token")}
            </label>
            <div className="flex gap-2">
              <Input
                id="edit-pu-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  config?.has_token
                    ? t("tokenKeepCurrent")
                    : t("tokenPlaceholder")
                }
              />
              {config?.has_token && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClearToken}
                  disabled={loading}
                >
                  {t("clearToken")}
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between py-1">
            <label
              htmlFor="edit-pu-enabled"
              className="text-xs font-medium cursor-pointer"
            >
              {t("enabled")}
            </label>
            <Switch
              id="edit-pu-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="flex items-center justify-between py-1">
            <label
              htmlFor="edit-pu-status"
              className="text-xs font-medium cursor-pointer"
            >
              {t("showInStatusBar")}
            </label>
            <Switch
              id="edit-pu-status"
              checked={showInStatusBar}
              onCheckedChange={setShowInStatusBar}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="edit-pu-interval" className="text-xs font-medium">
                {t("refreshIntervalMinutes")}
              </label>
              <Input
                id="edit-pu-interval"
                type="number"
                min={0}
                value={refreshInterval}
                onChange={(e) =>
                  setRefreshInterval(parseInt(e.target.value, 10) || 0)
                }
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="edit-pu-timeout" className="text-xs font-medium">
                {t("timeoutSeconds")}
              </label>
              <Input
                id="edit-pu-timeout"
                type="number"
                min={2}
                max={30}
                value={timeout}
                onChange={(e) => setTimeout(parseInt(e.target.value, 10) || 10)}
              />
            </div>
          </div>

          {testResult && (
            <div
              className={
                testResult.success
                  ? "rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
                  : "rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500"
              }
            >
              {testResult.success
                ? t("testResultOk", {
                    plan: testResult.plan_name ?? "--",
                    used: testResult.used?.toFixed(2) ?? "--",
                    total: testResult.total?.toFixed(2) ?? "--",
                    unit: testResult.unit,
                  })
                : (testResult.message ?? t("testFailed"))}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing || loading}
          >
            {testing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {t("test")}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
