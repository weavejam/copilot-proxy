import { Hono } from "hono"

import { state } from "~/lib/state"
import {
  computeUsageStats,
  type Lens,
  type UsageStatsFilters,
} from "~/lib/usage-stats"
import { makeApiContext } from "~/lib/utils"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

export const usageRoute = new Hono()

const VALID_LENSES: Array<Lens> = ["historical", "current", "timeline"]
const VALID_ENDPOINTS = new Set(["chat.completions", "messages", "embeddings"])

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function parseFilters(req: Request): UsageStatsFilters {
  const url = new URL(req.url)
  const now = Date.now()
  const fromRaw = url.searchParams.get("from")
  const toRaw = url.searchParams.get("to")
  const from = fromRaw ? Number.parseInt(fromRaw, 10) : now - THIRTY_DAYS_MS
  const to = toRaw ? Number.parseInt(toRaw, 10) : now
  const lensRaw = url.searchParams.get("lens") ?? "historical"
  const lens: Lens =
    (VALID_LENSES as Array<string>).includes(lensRaw) ?
      (lensRaw as Lens)
    : "historical"
  const endpoint = url.searchParams.get("endpoint")
  return {
    from,
    to,
    account: url.searchParams.get("account") ?? undefined,
    model: url.searchParams.get("model") ?? undefined,
    endpoint: endpoint && VALID_ENDPOINTS.has(endpoint) ? endpoint : undefined,
    lens,
  }
}

interface QuotaPayload {
  byAccount: Array<{ name: string; quota?: unknown; error?: string }>
  primary?: unknown
}

async function fetchQuota(): Promise<QuotaPayload> {
  const accounts = state.pool?.accounts ?? []
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const quota = await getCopilotUsage(makeApiContext(account))
        return { name: account.name, quota }
      } catch (err) {
        return { name: account.name, error: (err as Error).message }
      }
    }),
  )
  const primary = results.find((r) => "quota" in r && r.quota)?.quota
  return { byAccount: results, primary }
}

usageRoute.get("/", async (c) => {
  const stats = (() => {
    try {
      return computeUsageStats(parseFilters(c.req.raw))
    } catch (err) {
      console.error("Error computing usage stats:", err)
      return null
    }
  })()

  let quota: unknown = null
  let primary: unknown = null
  try {
    const result = await fetchQuota()
    quota = result
    primary = result.primary
  } catch (err) {
    console.error("Error fetching Copilot quota:", err)
  }

  // Backwards compat: top-level fields from the old payload (when present)
  // are spread from the primary account's response.
  return c.json({
    ...(primary as Record<string, unknown> | null | undefined),
    quota,
    stats,
  })
})
