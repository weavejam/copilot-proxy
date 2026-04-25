# 03 — Pricing, Sync, and Cost Lenses

## Pricing tables

```sql
-- Current price view (one row per model_id, materialized).
CREATE TABLE model_pricing (
  model_id TEXT PRIMARY KEY,
  input_per_mtok REAL,
  cached_input_per_mtok REAL,
  output_per_mtok REAL,
  reasoning_per_mtok REAL,
  premium_multiplier REAL,
  premium_unit_price REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT,                          -- 'azure-retail' | 'anthropic-public' | 'manual'
  source_skus TEXT,                     -- JSON array
  updated_at INTEGER NOT NULL
);

-- Append-only timeline. Old version's effective_to is patched on insert.
CREATE TABLE model_pricing_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL,
  effective_from INTEGER NOT NULL,      -- = sync commit time (detected_at)
  effective_to INTEGER,                 -- NULL = currently in force
  input_per_mtok REAL,
  cached_input_per_mtok REAL,
  output_per_mtok REAL,
  reasoning_per_mtok REAL,
  premium_multiplier REAL,
  premium_unit_price REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT,
  source_skus TEXT,
  sync_log_id INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (sync_log_id) REFERENCES pricing_sync_log(id)
);
CREATE INDEX idx_pricing_versions_model_time
  ON model_pricing_versions(model_id, effective_from);
CREATE INDEX idx_pricing_versions_current
  ON model_pricing_versions(model_id) WHERE effective_to IS NULL;

CREATE TABLE pricing_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL,                 -- 'ok' | 'partial' | 'failed' | 'rejected'
  source_count INTEGER,
  llm_model TEXT,
  models_updated INTEGER,
  models_rejected INTEGER,
  error TEXT,
  raw_request_json TEXT,
  raw_response_json TEXT,
  diff_json TEXT
);
```

## Sync task — high level

```
on server start:
  ensureSchema()
  loadAccounts()
  setupCopilotTokens(accounts)
  start http server                   ← serves traffic immediately
  spawn schedulePricingSync()         ← non-blocking
```

`schedulePricingSync()` reads `meta.last_pricing_sync_ts`, computes the next
fire time, and uses a `setTimeout` chain (no cron lib). On a missed window
(`now > last + interval`) it fires immediately.

## Sync task — body

```ts
runPricingSync():
  // 1. Pick the LLM
  syncModel = pickSyncModel()
    // priority:
    //   --pricing-sync-model (default 'gpt-5.4'),
    //   else first present in whitelist
    //     ['gpt-5','gpt-4.1','gpt-4o','claude-sonnet-4','claude-3-7-sonnet'],
    //   else state.models[0].id
    //   warn if fallback used

  // 2. Fetch sources
  azureRows = paginate(
    'https://prices.azure.com/api/retail/prices?$filter=' +
    "serviceName eq 'Cognitive Services' and " +
    "serviceFamily eq 'AI + Machine Learning'"
  )
  anthropicHtml = (anyKnownModel.startsWith('claude'))
    ? extractPricingSection(fetch('https://www.anthropic.com/pricing'))
    : null

  // 3. Call own proxy
  resp = POST http://localhost:<port>/v1/chat/completions
    headers: { 'x-internal-pricing-sync': '1' }
    body: {
      model: syncModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: NORMALIZER_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({
            knownModels: state.models.data.map(m => m.id),
            azureRows,
            anthropicHtml,
        })},
      ],
    }

  parsed = JSON.parse(resp.choices[0].message.content)

  // 4. Validate (per row)
  for each row in parsed.models:
    schemaCheck(row)
    rangeCheck(all *_per_mtok > 0 if not null)

  // 5. Sanity gate (cross-version, single bad row sinks the whole sync)
  if any sanityFails(currentForRow, row): status = 'rejected'; abort
```

### Sanity check

```ts
const PRICE_SANITY_RATIO = 10
function sanityFails(oldRow, newRow) {
  if (!oldRow) return false  // first time entry skips this gate
  for (const f of FIELDS) {
    const a = oldRow[f], b = newRow[f]
    if (!a || !b) continue
    const r = b / a
    if (r > PRICE_SANITY_RATIO || r < 1 / PRICE_SANITY_RATIO) return true
  }
  return false
}
```

### Change threshold

```ts
const PRICE_CHANGE_EPSILON = 0.005  // 0.5%
function priceChanged(oldRow, newRow) {
  for (const f of FIELDS) {
    const a = oldRow[f], b = newRow[f]
    if (a == null && b == null) continue
    if (a == null || b == null) return true
    if (a === 0 && b === 0) continue
    if (a === 0 || b === 0) return true
    if (Math.abs(b - a) / Math.abs(a) >= PRICE_CHANGE_EPSILON) return true
  }
  return false
}
```

`FIELDS` = the six numeric columns: `input_per_mtok`,
`cached_input_per_mtok`, `output_per_mtok`, `reasoning_per_mtok`,
`premium_multiplier`, `premium_unit_price`.

## Sync task — commit

```sql
BEGIN;

-- Per changed model:
UPDATE model_pricing_versions
   SET effective_to = ?detectedAt
 WHERE id = ?currentVersionId;

INSERT INTO model_pricing_versions (model_id, effective_from, effective_to,
  ...prices..., sync_log_id, created_at)
VALUES (?, ?detectedAt, NULL, ..., ?syncLogId, ?detectedAt);

INSERT INTO model_pricing (model_id, ...prices..., updated_at)
  VALUES (...)
ON CONFLICT(model_id) DO UPDATE SET ...;

INSERT INTO pricing_sync_log (...);
UPDATE meta SET value = ?detectedAt WHERE key = 'last_pricing_sync_ts';

COMMIT;
```

## Cost lenses

Three SQL templates. Dashboard picks one based on user toggle.

### Historical (snapshot — always stable)

```sql
SELECT SUM(
  input_tokens / 1e6 * input_price_snapshot
  + cached_input_tokens / 1e6 * cached_input_price_snapshot
  + output_tokens / 1e6 * output_price_snapshot
  + reasoning_tokens / 1e6 * reasoning_price_snapshot
) AS cost_usd
FROM usage_events
WHERE ts BETWEEN ? AND ?;
```

### Current (latest price for everything)

```sql
SELECT SUM(
  ue.input_tokens / 1e6 * mp.input_per_mtok
  + ue.cached_input_tokens / 1e6 * mp.cached_input_per_mtok
  + ue.output_tokens / 1e6 * mp.output_per_mtok
  + ue.reasoning_tokens / 1e6 * mp.reasoning_per_mtok
) AS cost_usd
FROM usage_events ue
JOIN model_pricing mp ON mp.model_id = ue.model_id
WHERE ue.ts BETWEEN ? AND ?;
```

### Timeline (price effective at the event's ts)

```sql
SELECT SUM(
  ue.input_tokens / 1e6 * pv.input_per_mtok
  + ue.cached_input_tokens / 1e6 * pv.cached_input_per_mtok
  + ue.output_tokens / 1e6 * pv.output_per_mtok
  + ue.reasoning_tokens / 1e6 * pv.reasoning_per_mtok
) AS cost_usd
FROM usage_events ue
JOIN model_pricing_versions pv
  ON pv.model_id = ue.model_id
 AND ue.ts >= pv.effective_from
 AND (ue.ts < pv.effective_to OR pv.effective_to IS NULL)
WHERE ue.ts BETWEEN ? AND ?;
```

Note: events that fired before the very first sync of their model produce
`NULL` cost under the timeline lens. Dashboard surfaces this as
"price not yet synced" — do not back-fill.

## `/usage` route

Backwards-compatible: existing `getCopilotUsage` body lives under `quota`.
New `stats` block:

```jsonc
{
  "quota": { /* fan-out and merge across accounts, or per-account list */ },
  "stats": {
    "range": { "from": ..., "to": ... },
    "currency": "USD",
    "lens": "historical",       // echo of the requested lens
    "totals": {
      "token":   { "input": ..., "cached_input": ..., "output": ...,
                   "reasoning": ..., "cost_usd": ... },
      "premium": { "requests": ..., "cost_usd": ... }
    },
    "byAccount": [
      { "name": "msft-1",
        "totals": { "token": {...}, "premium": {...} },
        "byModel": [
          { "model": "gpt-4.1",
            "endpoint_breakdown": {
              "chat.completions": { ... },
              "embeddings": { ... }
            },
            "token": {...}, "premium": {...} } ] } ],
    "daily": [
      { "day": "2026-04-25", "account": "msft-1", "model": "gpt-4.1",
        "token": {...}, "premium": {...} } ],
    "missing_pricing": ["some-model-id"]
  }
}
```

Query params: `?from=&to=&account=&model=&endpoint=&group=day|model|account|endpoint&lens=historical|current|timeline`.

## Dashboard

`pages/index.html` extensions:

- Lens toggle (3-way) + currency display
- Four cards: total cost, total requests, total tokens, active accounts
- Account × Model matrix table (cell shows tokens above, cost below)
- Daily cost stacked bar chart (color = account)
- Daily token line chart (lines = input / cached / output / reasoning)
- Missing-pricing list
- New page: **Price timeline** — for each model, a step chart over time;
  hover reveals `sync_log_id` and the diff JSON

Use Chart.js via CDN. No frontend framework.
