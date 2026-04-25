import type { Database } from "bun:sqlite"

import { getDb } from "./db"

export type Lens = "historical" | "current" | "timeline"

export interface UsageStatsFilters {
  from: number
  to: number
  account?: string
  model?: string
  endpoint?: string
  lens: Lens
}

export interface TokenTotals {
  input: number
  cached_input: number
  output: number
  reasoning: number
  cost_usd: number | null
}

export interface PremiumTotals {
  requests: number
  cost_usd: number | null
}

export interface UsageStats {
  range: { from: number; to: number }
  currency: string
  lens: Lens
  totals: { token: TokenTotals; premium: PremiumTotals }
  byAccount: Array<{
    name: string
    totals: { token: TokenTotals; premium: PremiumTotals }
    byModel: Array<{
      model: string
      endpoint_breakdown: Record<string, TokenTotals & PremiumTotals>
      token: TokenTotals
      premium: PremiumTotals
    }>
  }>
  daily: Array<{
    day: string
    account: string
    model: string
    token: TokenTotals
    premium: PremiumTotals
  }>
  missing_pricing: Array<string>
}

const COST_EXPRESSIONS: Record<Lens, { table: string; cost: string }> = {
  historical: {
    table: "usage_events ue",
    cost: `(
      ue.input_tokens / 1e6 * ue.input_price_snapshot
      + ue.cached_input_tokens / 1e6 * ue.cached_input_price_snapshot
      + ue.output_tokens / 1e6 * ue.output_price_snapshot
      + ue.reasoning_tokens / 1e6 * ue.reasoning_price_snapshot
    )`,
  },
  current: {
    table:
      "usage_events ue LEFT JOIN model_pricing mp ON mp.model_id = ue.model_id",
    cost: `(
      ue.input_tokens / 1e6 * mp.input_per_mtok
      + ue.cached_input_tokens / 1e6 * mp.cached_input_per_mtok
      + ue.output_tokens / 1e6 * mp.output_per_mtok
      + ue.reasoning_tokens / 1e6 * mp.reasoning_per_mtok
    )`,
  },
  timeline: {
    table:
      "usage_events ue LEFT JOIN model_pricing_versions pv ON pv.model_id = ue.model_id AND ue.ts >= pv.effective_from AND (pv.effective_to IS NULL OR ue.ts < pv.effective_to)",
    cost: `(
      ue.input_tokens / 1e6 * pv.input_per_mtok
      + ue.cached_input_tokens / 1e6 * pv.cached_input_per_mtok
      + ue.output_tokens / 1e6 * pv.output_per_mtok
      + ue.reasoning_tokens / 1e6 * pv.reasoning_per_mtok
    )`,
  },
}

interface FilterClause {
  sql: string
  params: Array<string | number>
}

function buildFilter(f: UsageStatsFilters): FilterClause {
  const where: Array<string> = ["ue.ts BETWEEN ? AND ?"]
  const params: Array<string | number> = [f.from, f.to]
  if (f.account) {
    where.push("ue.account_name = ?")
    params.push(f.account)
  }
  if (f.model) {
    where.push("ue.model_id = ?")
    params.push(f.model)
  }
  if (f.endpoint) {
    where.push("ue.endpoint = ?")
    params.push(f.endpoint)
  }
  return { sql: where.join(" AND "), params }
}

interface AggregateRow {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cost_usd: number | null
  premium_requests: number
  premium_cost_usd: number | null
}

interface ByAccountRow extends AggregateRow {
  account_name: string
}

interface ByAccountModelRow extends AggregateRow {
  account_name: string
  model_id: string
  endpoint: string
}

interface DailyRow extends AggregateRow {
  day: string
  account_name: string
  model_id: string
}

const COMMON_AGGREGATE = (cost: string) => `
  SUM(ue.input_tokens) AS input_tokens,
  SUM(ue.cached_input_tokens) AS cached_input_tokens,
  SUM(ue.output_tokens) AS output_tokens,
  SUM(ue.reasoning_tokens) AS reasoning_tokens,
  SUM(${cost}) AS cost_usd,
  SUM(ue.premium_request_count) AS premium_requests,
  SUM(ue.premium_request_count * COALESCE(ue.premium_unit_price_snapshot, 0))
    AS premium_cost_usd
`

function tokenTotals(r: AggregateRow): TokenTotals {
  return {
    input: r.input_tokens || 0,
    cached_input: r.cached_input_tokens || 0,
    output: r.output_tokens || 0,
    reasoning: r.reasoning_tokens || 0,
    cost_usd: r.cost_usd,
  }
}

function premiumTotals(r: AggregateRow): PremiumTotals {
  return {
    requests: r.premium_requests || 0,
    cost_usd: r.premium_cost_usd,
  }
}

function buildByAccount(
  byAccountRows: Array<ByAccountRow>,
  byAccountModelRows: Array<ByAccountModelRow>,
): UsageStats["byAccount"] {
  return byAccountRows.map((acc) => {
    const modelMap = new Map<
      string,
      {
        model: string
        endpoint_breakdown: Record<string, TokenTotals & PremiumTotals>
        agg: AggregateRow
      }
    >()
    for (const row of byAccountModelRows) {
      if (row.account_name !== acc.account_name) continue
      let entry = modelMap.get(row.model_id)
      if (!entry) {
        entry = {
          model: row.model_id,
          endpoint_breakdown: {},
          agg: {
            input_tokens: 0,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_tokens: 0,
            cost_usd: 0,
            premium_requests: 0,
            premium_cost_usd: 0,
          },
        }
        modelMap.set(row.model_id, entry)
      }
      entry.endpoint_breakdown[row.endpoint] = {
        ...tokenTotals(row),
        ...premiumTotals(row),
      }
      entry.agg.input_tokens += row.input_tokens || 0
      entry.agg.cached_input_tokens += row.cached_input_tokens || 0
      entry.agg.output_tokens += row.output_tokens || 0
      entry.agg.reasoning_tokens += row.reasoning_tokens || 0
      entry.agg.cost_usd = (entry.agg.cost_usd ?? 0) + (row.cost_usd ?? 0)
      entry.agg.premium_requests += row.premium_requests || 0
      entry.agg.premium_cost_usd =
        (entry.agg.premium_cost_usd ?? 0) + (row.premium_cost_usd ?? 0)
    }
    return {
      name: acc.account_name,
      totals: { token: tokenTotals(acc), premium: premiumTotals(acc) },
      byModel: [...modelMap.values()].map((m) => ({
        model: m.model,
        endpoint_breakdown: m.endpoint_breakdown,
        token: tokenTotals(m.agg),
        premium: premiumTotals(m.agg),
      })),
    }
  })
}

export function computeUsageStats(filters: UsageStatsFilters): UsageStats {
  const db: Database = getDb()
  const { table, cost } = COST_EXPRESSIONS[filters.lens]
  const filter = buildFilter(filters)

  const totalsRow =
    db
      .query<
        AggregateRow,
        Array<string | number>
      >(`SELECT ${COMMON_AGGREGATE(cost)} FROM ${table} WHERE ${filter.sql}`)
      .get(...filter.params)
    ?? ({
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cost_usd: 0,
      premium_requests: 0,
      premium_cost_usd: 0,
    } as AggregateRow)

  const byAccountRows = db
    .query<ByAccountRow, Array<string | number>>(
      `SELECT ue.account_name, ${COMMON_AGGREGATE(cost)}
       FROM ${table}
       WHERE ${filter.sql}
       GROUP BY ue.account_name
       ORDER BY ue.account_name`,
    )
    .all(...filter.params)

  const byAccountModelRows = db
    .query<ByAccountModelRow, Array<string | number>>(
      `SELECT ue.account_name, ue.model_id, ue.endpoint, ${COMMON_AGGREGATE(cost)}
       FROM ${table}
       WHERE ${filter.sql}
       GROUP BY ue.account_name, ue.model_id, ue.endpoint
       ORDER BY ue.account_name, ue.model_id, ue.endpoint`,
    )
    .all(...filter.params)

  const dailyRows = db
    .query<DailyRow, Array<string | number>>(
      `SELECT date(ue.ts/1000, 'unixepoch', 'localtime') AS day,
              ue.account_name, ue.model_id, ${COMMON_AGGREGATE(cost)}
       FROM ${table}
       WHERE ${filter.sql}
       GROUP BY day, ue.account_name, ue.model_id
       ORDER BY day, ue.account_name, ue.model_id`,
    )
    .all(...filter.params)

  const missing = db
    .query<{ model_id: string }, [number, number]>(
      `SELECT DISTINCT model_id FROM usage_events
       WHERE model_id NOT IN (SELECT model_id FROM model_pricing)
         AND ts BETWEEN ? AND ?`,
    )
    .all(filters.from, filters.to)
    .map((r) => r.model_id)

  return {
    range: { from: filters.from, to: filters.to },
    currency: "USD",
    lens: filters.lens,
    totals: {
      token: tokenTotals(totalsRow),
      premium: premiumTotals(totalsRow),
    },
    byAccount: buildByAccount(byAccountRows, byAccountModelRows),
    daily: dailyRows.map((r) => ({
      day: r.day,
      account: r.account_name,
      model: r.model_id,
      token: tokenTotals(r),
      premium: premiumTotals(r),
    })),
    missing_pricing: missing,
  }
}
