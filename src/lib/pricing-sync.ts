import consola from "consola"

import type { AzureRow } from "./pricing-sources"

import {
  fetchAnthropicPricingHtml,
  fetchAzureRetailPrices,
} from "./pricing-sources"
import { state } from "./state"

export const PRICING_FIELDS = [
  "input_per_mtok",
  "cached_input_per_mtok",
  "output_per_mtok",
  "reasoning_per_mtok",
  "premium_multiplier",
  "premium_unit_price",
] as const

export type PricingField = (typeof PRICING_FIELDS)[number]

export interface PricingRow {
  model_id: string
  input_per_mtok: number | null
  cached_input_per_mtok: number | null
  output_per_mtok: number | null
  reasoning_per_mtok: number | null
  premium_multiplier: number | null
  premium_unit_price: number | null
  currency?: string | null
  source?: string | null
  source_skus?: Array<string> | null
}

export interface ParsedPricing {
  models: Array<PricingRow>
}

export interface SyncRequest {
  knownModels: Array<string>
  azureRows: Array<AzureRow>
  anthropicHtml: string | null
}

const PRICE_CHANGE_EPSILON = 0.005
const PRICE_SANITY_RATIO = 10

export const SYNC_MODEL_WHITELIST = [
  "gpt-5",
  "gpt-4.1",
  "gpt-4o",
  "claude-sonnet-4",
  "claude-3-7-sonnet",
]

export function pickSyncModel(cliFlag: string | undefined): string {
  const known = state.models?.data.map((m) => m.id) ?? []
  if (cliFlag && known.includes(cliFlag)) return cliFlag
  for (const wl of SYNC_MODEL_WHITELIST) {
    if (known.includes(wl)) {
      if (cliFlag && cliFlag !== wl) {
        consola.warn(
          `Pricing sync model "${cliFlag}" not available; falling back to "${wl}"`,
        )
      }
      return wl
    }
  }
  if (known.length === 0) {
    throw new Error("Cannot pick sync model: state.models is empty")
  }
  consola.warn(
    `Pricing sync whitelist had no match; falling back to first available model "${known[0]}"`,
  )
  return known[0]
}

export async function buildSyncRequest(): Promise<SyncRequest> {
  const knownModels = state.models?.data.map((m) => m.id) ?? []
  const hasClaude = knownModels.some((m) => m.startsWith("claude"))
  const [azureRows, anthropicHtml] = await Promise.all([
    fetchAzureRetailPrices(),
    hasClaude ? fetchAnthropicPricingHtml() : Promise.resolve(null),
  ])
  return { knownModels, azureRows, anthropicHtml }
}

export const NORMALIZER_SYSTEM_PROMPT = `You are a pricing extractor. Convert raw price source rows from Azure Retail Prices API and the Anthropic public pricing page into a normalized JSON shape.

Output schema (strict JSON, no prose):
{
  "models": [
    {
      "model_id": "string – must match one of the supplied knownModels exactly",
      "input_per_mtok": number | null,
      "cached_input_per_mtok": number | null,
      "output_per_mtok": number | null,
      "reasoning_per_mtok": number | null,
      "premium_multiplier": number | null,
      "premium_unit_price": number | null,
      "currency": "USD",
      "source": "azure-retail" | "anthropic-public" | "manual",
      "source_skus": ["string array of source SKU/product identifiers used"]
    }
  ]
}

Rules:
- Only include models present in knownModels. Skip everything else.
- Use USD; if a row is in another currency, convert to USD only if obvious, otherwise omit.
- "per_mtok" means dollars per 1,000,000 tokens. Convert per-1k or per-token rates accordingly.
- premium_multiplier and premium_unit_price come from GitHub Copilot premium pricing — do not invent.
- Leave fields you cannot confidently derive as null. Do not guess.
- Output a single JSON object. No markdown fences, no commentary.`

export interface CallSyncLlmOptions {
  port: number
  fetchImpl?: typeof fetch
}

export async function callSyncLlm(
  req: SyncRequest,
  modelId: string,
  options: CallSyncLlmOptions,
): Promise<ParsedPricing> {
  const fetchImpl = options.fetchImpl ?? fetch
  const resp = await fetchImpl(
    `http://localhost:${options.port}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-pricing-sync": "1",
      },
      body: JSON.stringify({
        model: modelId,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: NORMALIZER_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(req) },
        ],
      }),
    },
  )
  if (!resp.ok) {
    throw new Error(
      `Pricing-sync LLM call failed: ${resp.status} ${resp.statusText}`,
    )
  }
  const body = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = body.choices?.[0]?.message?.content
  if (!content) {
    throw new Error("Pricing-sync LLM response had no content")
  }
  const parsed = JSON.parse(content) as ParsedPricing
  if (!Array.isArray(parsed.models)) {
    throw new TypeError("Pricing-sync LLM response missing `models` array")
  }
  return parsed
}

function diffsExceeds(
  a: number | null | undefined,
  b: number | null | undefined,
  epsilon: number,
): boolean {
  if (a === null && b === null) return false
  if (a === null || b === null) return true
  if (a === 0 && b === 0) return false
  if (a === 0 || b === 0) return true
  return Math.abs(b - a) / Math.abs(a) >= epsilon
}

export function priceChanged(
  oldRow: Partial<Record<PricingField, number | null>> | null | undefined,
  newRow: Partial<Record<PricingField, number | null>>,
): boolean {
  if (!oldRow) return true
  for (const f of PRICING_FIELDS) {
    if (
      diffsExceeds(oldRow[f] ?? null, newRow[f] ?? null, PRICE_CHANGE_EPSILON)
    ) {
      return true
    }
  }
  return false
}

export function sanityFails(
  oldRow: Partial<Record<PricingField, number | null>> | null | undefined,
  newRow: Partial<Record<PricingField, number | null>>,
): boolean {
  if (!oldRow) return false
  for (const f of PRICING_FIELDS) {
    const a = oldRow[f] ?? null
    const b = newRow[f] ?? null
    if (a === null || b === null || a === 0 || b === 0) continue
    const r = b / a
    if (r > PRICE_SANITY_RATIO || r < 1 / PRICE_SANITY_RATIO) return true
  }
  return false
}
