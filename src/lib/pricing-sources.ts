/**
 * Fetchers for raw pricing source data: Azure Retail Prices API and the
 * Anthropic public pricing page. No DB writes, no LLM, no `state`.
 */

const AZURE_FILTER = encodeURIComponent(
  "serviceName eq 'Cognitive Services' and serviceFamily eq 'AI + Machine Learning'",
)
const AZURE_BASE = `https://prices.azure.com/api/retail/prices?$filter=${AZURE_FILTER}`
const ANTHROPIC_PRICING_URL = "https://www.anthropic.com/pricing"

export interface AzureRow {
  meterName?: string
  productName?: string
  skuName?: string
  retailPrice?: number
  unitOfMeasure?: string
  currencyCode?: string
  armSkuName?: string
  serviceName?: string
}

interface AzureResponse {
  Items?: Array<AzureRow>
  NextPageLink?: string | null
}

/**
 * Page through the Azure Retail Prices API until exhausted.
 * Returns ALL rows for `serviceName = Cognitive Services` and
 * `serviceFamily = AI + Machine Learning`.
 */
export async function fetchAzureRetailPrices(
  fetchImpl: typeof fetch = fetch,
): Promise<Array<AzureRow>> {
  const out: Array<AzureRow> = []
  let url: string | null | undefined = AZURE_BASE
  while (url) {
    const resp = await fetchImpl(url)
    if (!resp.ok) {
      throw new Error(
        `Azure pricing fetch failed: ${resp.status} ${resp.statusText}`,
      )
    }
    const body = (await resp.json()) as AzureResponse
    if (body.Items) out.push(...body.Items)
    url = body.NextPageLink ?? null
  }
  return out
}

/**
 * Best-effort extract of the pricing section from anthropic.com/pricing.
 * Returns the raw HTML; LLM is responsible for parsing. Returns null on
 * fetch failure or if the HTML doesn't look like a pricing page.
 */
export async function fetchAnthropicPricingHtml(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const resp = await fetchImpl(ANTHROPIC_PRICING_URL)
    if (!resp.ok) return null
    const html = await resp.text()
    if (!/pricing|per million/i.test(html)) return null
    return html
  } catch {
    return null
  }
}
