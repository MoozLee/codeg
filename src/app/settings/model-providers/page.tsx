"use client"

import { useTranslations } from "next-intl"
import { Receipt, Server } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { ModelProviderList } from "@/components/settings/model-provider-settings"
import { ProviderUsageQueryList } from "@/components/settings/provider-usage-query-settings"

export default function SettingsModelProvidersPage() {
  const tProvider = useTranslations("ModelProviderSettings")
  const tUsage = useTranslations("ProviderUsageQuerySettings")

  return (
    <ScrollArea className="h-full">
      <div className="w-full space-y-4 p-3 md:p-4">
        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              {tProvider("sectionTitle")}
            </h2>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            {tProvider("sectionDescription")}
          </p>

          <ModelProviderList />
        </section>

        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{tUsage("sectionTitle")}</h2>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            {tUsage("sectionDescription")}
          </p>

          <ProviderUsageQueryList />
        </section>
      </div>
    </ScrollArea>
  )
}
