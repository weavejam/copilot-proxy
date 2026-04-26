import consola from "consola"

import { getDb } from "./db"
import {
  buildSyncRequest,
  callSyncLlm,
  pickSyncModel,
  priceChanged,
  PRICING_FIELDS,
  sanityFails,
  type ParsedPricing,
  type PricingField,
  type PricingRow,
} from "./pricing-sync"

export type SyncStatus = "ok" | "partial" | "rejected" | "failed"

export interface RunPricingSyncOptions {
  port: number
  syncModel?: string
  /** Test seam: bypass HTTP fetchers and inject the parsed result directly. */
  parsedOverride?: ParsedPricing
}

export interface RunPricingSyncResult {
  status: SyncStatus
  updated: number
  rejected: number
  logId?: number
  error?: string
}

interface CurrentRow {
  id: number
  input_per_mtok: number | null
  cached_input_per_mtok: number | null
  output_per_mtok: number | null
  reasoning_per_mtok: number | null
  premium_multiplier: number | null
  premium_unit_price: number | null
}

function selectCurrentVersion(modelId: string): CurrentRow | undefined {
  return (
    (getDb()
      .prepare(
        `SELECT id, input_per_mtok, cached_input_per_mtok, output_per_mtok,
              reasoning_per_mtok, premium_multiplier, premium_unit_price
         FROM model_pricing_versions
        WHERE model_id = ? AND effective_to IS NULL`,
      )
      .get(modelId) as CurrentRow | undefined) ?? undefined
  )
}

function rowToFieldMap(row: PricingRow): Record<PricingField, number | null> {
  const out: Record<PricingField, number | null> = {
    input_per_mtok: null,
    cached_input_per_mtok: null,
    output_per_mtok: null,
    reasoning_per_mtok: null,
    premium_multiplier: null,
    premium_unit_price: null,
  }
  for (const f of PRICING_FIELDS) {
    out[f] = row[f] ?? null
  }
  return out
}

interface ApplyArgs {
  row: PricingRow
  detectedAt: number
  syncLogId: number
}

function applyPricingChange(args: ApplyArgs): "changed" | "unchanged" {
  const db = getDb()
  const newRow = rowToFieldMap(args.row)
  const current = selectCurrentVersion(args.row.model_id)
  if (current && !priceChanged(current, newRow)) {
    return "unchanged"
  }
  if (current) {
    db.prepare(
      "UPDATE model_pricing_versions SET effective_to = ? WHERE id = ?",
    ).run(args.detectedAt, current.id)
  }
  db.prepare(
    `INSERT INTO model_pricing_versions (
       model_id, effective_from, effective_to,
       input_per_mtok, cached_input_per_mtok, output_per_mtok,
       reasoning_per_mtok, premium_multiplier, premium_unit_price,
       currency, source, source_skus, sync_log_id, created_at
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.row.model_id,
    args.detectedAt,
    newRow.input_per_mtok,
    newRow.cached_input_per_mtok,
    newRow.output_per_mtok,
    newRow.reasoning_per_mtok,
    newRow.premium_multiplier,
    newRow.premium_unit_price,
    args.row.currency ?? "USD",
    args.row.source ?? null,
    args.row.source_skus ? JSON.stringify(args.row.source_skus) : null,
    args.syncLogId,
    args.detectedAt,
  )
  db.prepare(
    `INSERT INTO model_pricing (
       model_id, input_per_mtok, cached_input_per_mtok, output_per_mtok,
       reasoning_per_mtok, premium_multiplier, premium_unit_price,
       currency, source, source_skus, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(model_id) DO UPDATE SET
       input_per_mtok = excluded.input_per_mtok,
       cached_input_per_mtok = excluded.cached_input_per_mtok,
       output_per_mtok = excluded.output_per_mtok,
       reasoning_per_mtok = excluded.reasoning_per_mtok,
       premium_multiplier = excluded.premium_multiplier,
       premium_unit_price = excluded.premium_unit_price,
       currency = excluded.currency,
       source = excluded.source,
       source_skus = excluded.source_skus,
       updated_at = excluded.updated_at`,
  ).run(
    args.row.model_id,
    newRow.input_per_mtok,
    newRow.cached_input_per_mtok,
    newRow.output_per_mtok,
    newRow.reasoning_per_mtok,
    newRow.premium_multiplier,
    newRow.premium_unit_price,
    args.row.currency ?? "USD",
    args.row.source ?? null,
    args.row.source_skus ? JSON.stringify(args.row.source_skus) : null,
    args.detectedAt,
  )
  return "changed"
}

export async function runPricingSync(
  options: RunPricingSyncOptions,
): Promise<RunPricingSyncResult> {
  const detectedAt = Date.now()
  let parsed: ParsedPricing
  let llmModel = "n/a"
  try {
    if (options.parsedOverride) {
      parsed = options.parsedOverride
    } else {
      const req = await buildSyncRequest()
      llmModel = pickSyncModel(options.syncModel)
      parsed = await callSyncLlm(req, llmModel, { port: options.port })
    }
  } catch (err) {
    consola.error("Pricing sync fetch/LLM failed:", err)
    const logId = recordSyncLog({
      ts: detectedAt,
      status: "failed",
      llmModel,
      modelsUpdated: 0,
      modelsRejected: 0,
      error: (err as Error).message,
    })
    return {
      status: "failed",
      updated: 0,
      rejected: 0,
      logId,
      error: (err as Error).message,
    }
  }

  // Sanity gate: any row failing sanity rejects the entire sync.
  for (const row of parsed.models) {
    const current = selectCurrentVersion(row.model_id)
    if (sanityFails(current ?? null, rowToFieldMap(row))) {
      consola.warn(
        `Pricing sync rejected: sanity check failed for model ${row.model_id}`,
      )
      const logId = recordSyncLog({
        ts: detectedAt,
        status: "rejected",
        llmModel,
        modelsUpdated: 0,
        modelsRejected: parsed.models.length,
      })
      return {
        status: "rejected",
        updated: 0,
        rejected: parsed.models.length,
        logId,
      }
    }
  }

  let updated = 0
  const logId = recordSyncLog({
    ts: detectedAt,
    status: "ok",
    llmModel,
    modelsUpdated: 0,
    modelsRejected: 0,
  })

  const tx = getDb().transaction(() => {
    for (const row of parsed.models) {
      const result = applyPricingChange({
        row,
        detectedAt,
        syncLogId: logId,
      })
      if (result === "changed") updated += 1
    }
    getDb()
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('last_pricing_sync_ts', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(detectedAt))
    getDb()
      .prepare(
        "UPDATE pricing_sync_log SET models_updated = ?, source_count = ? WHERE id = ?",
      )
      .run(updated, parsed.models.length, logId)
  })
  tx()

  return { status: "ok", updated, rejected: 0, logId }
}

interface RecordSyncLogArgs {
  ts: number
  status: SyncStatus
  llmModel: string
  modelsUpdated: number
  modelsRejected: number
  error?: string
}

function recordSyncLog(args: RecordSyncLogArgs): number {
  const stmt = getDb().prepare(
    `INSERT INTO pricing_sync_log
       (ts, status, llm_model, models_updated, models_rejected, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const result = stmt.run(
    args.ts,
    args.status,
    args.llmModel,
    args.modelsUpdated,
    args.modelsRejected,
    args.error ?? null,
  )
  return Number(result.lastInsertRowid)
}
