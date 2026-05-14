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
  const [balanceChecked, setBalanceChecked] = useState(true)
  const [subscriptionChecked, setSubscriptionChecked] = useState(false)
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
      const kinds = (config.query_kinds ?? []) as QueryKind[]
      setBalanceChecked(kinds.includes("newapi_balance"))
      setSubscriptionChecked(kinds.includes("newapi_subscription"))
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

  const collectQueryKinds = useCallback((): QueryKind[] => {
    const kinds: QueryKind[] = []
    if (balanceChecked) kinds.push("newapi_balance")
    if (subscriptionChecked) kinds.push("newapi_subscription")
    return kinds
  }, [balanceChecked, subscriptionChecked])

  const validate = useCallback((): string | null => {
    if (!name.trim()) return t("nameRequired")
    const urlErr = validateBaseUrl(baseUrl)
    if (urlErr === "baseUrlRequired") return t("baseUrlRequired")
    if (urlErr === "baseUrlHttpsRequired") return t("baseUrlHttpsRequired")
    if (!userId.trim()) return t("userIdRequired")
    if (timeout < 2 || timeout > 30) return t("timeoutRange")
    if (refreshInterval < 0) return t("refreshIntervalRange")
    if (collectQueryKinds().length === 0) return t("queryKindsRequired")
    return null
  }, [name, baseUrl, userId, timeout, refreshInterval, collectQueryKinds, t])

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
        queryKinds: collectQueryKinds(),
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
      const message = toErrorMessage(err)
      setError(message)
      toast.error(message)
    } finally {
      setTesting(false)
    }
  }, [config, validate, collectQueryKinds, baseUrl, userId, timeout, token, t])

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
        queryKinds: collectQueryKinds(),
        baseUrl: baseUrl.trim(),
        userId: userId.trim(),
        enabled,
        showInStatusBar,
        refreshIntervalMinutes: refreshInterval,
        timeoutSeconds: timeout,
      })
      if (token.trim()) {
        try {
          await saveProviderUsageToken(config.id, token.trim())
        } catch (tokenErr) {
          const message = toErrorMessage(tokenErr)
          setError(message)
          toast.error(message)
          onConfigUpdated()
          return
        }
      }
      toast.success(t("editSuccess"))
      handleOpenChange(false)
      onConfigUpdated()
    } catch (err) {
      const message = toErrorMessage(err)
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [
    config,
    validate,
    name,
    collectQueryKinds,
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
      const message = toErrorMessage(err)
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [config, onConfigUpdated, t])

  const canSubmit = collectQueryKinds().length > 0

  return (
    <Dialog open={!!config} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("editDialogTitle")}</DialogTitle>
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
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={balanceChecked}
                  onChange={(e) => setBalanceChecked(e.target.checked)}
                />
                <span>{t("queryKindBalance")}</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={subscriptionChecked}
                  onChange={(e) => setSubscriptionChecked(e.target.checked)}
                />
                <span>{t("queryKindSubscription")}</span>
              </label>
            </div>
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
            disabled={testing || loading || !canSubmit}
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
          <Button onClick={handleSubmit} disabled={loading || !canSubmit}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
