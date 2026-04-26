import { Hono } from "hono"

import { getDb } from "~/lib/db"
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

interface PricingEntry {
  model_id: string
  input_per_mtok: number | null
  cached_input_per_mtok: number | null
  output_per_mtok: number | null
  reasoning_per_mtok: number | null
  premium_multiplier: number | null
  premium_unit_price: number | null
  source: string | null
  updated_at: number | null
}

interface SyncLogEntry {
  id: number
  ts: number
  status: string
  llm_model: string
  models_updated: number
  models_rejected: number
  error: string | null
}

function fetchPricingMeta(): {
  models: Array<PricingEntry>
  lastSync: SyncLogEntry | null
} {
  try {
    const db = getDb()
    const models = db
      .prepare(
        `SELECT model_id, input_per_mtok, cached_input_per_mtok,
                output_per_mtok, reasoning_per_mtok,
                premium_multiplier, premium_unit_price,
                source, updated_at
         FROM model_pricing ORDER BY model_id`,
      )
      .all() as Array<PricingEntry>
    const lastSync =
      (db
        .prepare(
          `SELECT id, ts, status, llm_model, models_updated, models_rejected, error
         FROM pricing_sync_log ORDER BY id DESC LIMIT 1`,
        )
        .get() as SyncLogEntry | undefined) ?? null
    return { models, lastSync }
  } catch {
    return { models: [], lastSync: null }
  }
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
    pricing: fetchPricingMeta(),
  })
})
