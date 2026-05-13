import consola from "consola"

import type { Account } from "./account-pool"
import type { NormalizedUsage } from "./usage-normalizer"

import { getDb } from "./db"

export type UsageEndpoint =
  | "chat.completions"
  | "messages"
  | "embeddings"
  | "responses"
export type UpstreamFormat = "openai" | "anthropic"
export type UsageStatus = "ok" | "error" | "aborted"

export interface RecordUsageInput {
  account: Account
  modelId: string
  endpoint: UsageEndpoint
  upstreamFormat: UpstreamFormat
  isStreaming: boolean
  usage: NormalizedUsage
  durationMs: number
  status: UsageStatus
  requestId?: string
  isInternal?: boolean
}

interface PricingRow {
  input_per_mtok: number | null
  cached_input_per_mtok: number | null
  output_per_mtok: number | null
  reasoning_per_mtok: number | null
  premium_unit_price: number | null
  premium_multiplier: number | null
}

/**
 * Record a single upstream usage event and atomically update the daily
 * aggregate. Errors are swallowed (logged via consola); recorder failure
 * must not break the caller's response path.
 */
export function recordUsage(input: RecordUsageInput): void {
  if (input.isInternal) return

  try {
    const db = getDb()
    const ts = Date.now()

    const pricing = db
      .prepare(
        `SELECT input_per_mtok,
                cached_input_per_mtok,
                output_per_mtok,
                reasoning_per_mtok,
                premium_unit_price,
                premium_multiplier
           FROM model_pricing
          WHERE model_id = ?`,
      )
      .get(input.modelId) as PricingRow | undefined

    const inputPrice = pricing?.input_per_mtok ?? null
    const cachedInputPrice = pricing?.cached_input_per_mtok ?? null
    const outputPrice = pricing?.output_per_mtok ?? null
    const reasoningPrice = pricing?.reasoning_per_mtok ?? null
    const premiumUnitPrice = pricing?.premium_unit_price ?? null
    const premiumMultiplier = pricing?.premium_multiplier ?? null
    const premiumRequestCount = premiumMultiplier ?? 0

    const insertEvent = db.prepare(
      `INSERT INTO usage_events (
         ts, account_name, model_id, endpoint, upstream_format, is_streaming,
         input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
         total_tokens, premium_request_count,
         input_price_snapshot, cached_input_price_snapshot,
         output_price_snapshot, reasoning_price_snapshot,
         premium_unit_price_snapshot, premium_multiplier_snapshot,
         request_id, status, duration_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    const upsertDaily = db.prepare(
      `INSERT INTO usage_daily (
         day, account_name, model_id, endpoint,
         req_count, input_tokens, cached_input_tokens,
         output_tokens, reasoning_tokens, total_tokens, premium_requests
       ) VALUES (
         date(?/1000, 'unixepoch', 'localtime'),
         ?, ?, ?, 1, ?, ?, ?, ?, ?, ?
       )
       ON CONFLICT(day, account_name, model_id, endpoint) DO UPDATE SET
         req_count = req_count + 1,
         input_tokens = input_tokens + excluded.input_tokens,
         cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
         total_tokens = total_tokens + excluded.total_tokens,
         premium_requests = premium_requests + excluded.premium_requests`,
    )

    const tx = db.transaction(() => {
      insertEvent.run(
        ts,
        input.account.name,
        input.modelId,
        input.endpoint,
        input.upstreamFormat,
        input.isStreaming ? 1 : 0,
        input.usage.inputTokens,
        input.usage.cachedInputTokens,
        input.usage.outputTokens,
        input.usage.reasoningTokens,
        input.usage.totalTokens,
        premiumRequestCount,
        inputPrice,
        cachedInputPrice,
        outputPrice,
        reasoningPrice,
        premiumUnitPrice,
        premiumMultiplier,
        input.requestId ?? null,
        input.status,
        input.durationMs,
      )
      upsertDaily.run(
        ts,
        input.account.name,
        input.modelId,
        input.endpoint,
        input.usage.inputTokens,
        input.usage.cachedInputTokens,
        input.usage.outputTokens,
        input.usage.reasoningTokens,
        input.usage.totalTokens,
        premiumRequestCount,
      )
    })
    tx()
  } catch (err) {
    consola.error("[usage-recorder] failed to record usage:", err)
  }
}
