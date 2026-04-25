# Task 12 — Pricing sync core

**Depends on:** 02
**Unblocks:** 13

## Goal

Two fetchers + one LLM caller + validators. No DB writes yet (task 13 owns
the version-write logic).

## Scope

New file `src/lib/pricing-sources.ts`:

```ts
export async function fetchAzureRetailPrices(): Promise<AzureRow[]>
export async function fetchAnthropicPricingHtml(): Promise<string | null>
```

- Azure: `https://prices.azure.com/api/retail/prices?$filter=serviceName eq 'Cognitive Services' and serviceFamily eq 'AI + Machine Learning'`
  with paging (`NextPageLink`). Return all rows.
- Anthropic: GET `https://www.anthropic.com/pricing`, locate the pricing
  section, return the HTML slice (or null if not found / claude not in
  `state.models`).

New file `src/lib/pricing-sync.ts` (validators + LLM caller part only):

```ts
export async function buildSyncRequest(): Promise<SyncRequest>
export async function callSyncLlm(req: SyncRequest, model: string): Promise<ParsedPricing>
export function pickSyncModel(state, cliFlag): string
export function priceChanged(oldRow, newRow): boolean       // 0.5%
export function sanityFails(oldRow, newRow): boolean        // 10x
```

`pickSyncModel` priority:

1. CLI flag value if it is in `state.models`.
2. First match in whitelist `['gpt-5', 'gpt-4.1', 'gpt-4o',
   'claude-sonnet-4', 'claude-3-7-sonnet']`.
3. `state.models.data[0].id`.

LLM call always sets `x-internal-pricing-sync: 1` and
`response_format: { type: 'json_object' }`.

System prompt: see design doc 03. The user message carries
`{ knownModels, azureRows, anthropicHtml }`.

## Definition of Done

- [ ] Unit tests for `priceChanged` (epsilon edges, NULL vs value, zero).
- [ ] Unit tests for `sanityFails` (10x boundary, NULL handling).
- [ ] Unit test for `pickSyncModel` — flag set / flag invalid / fallback path.
- [ ] Manual run of `fetchAzureRetailPrices()` returns >100 rows and
  populates expected fields.
