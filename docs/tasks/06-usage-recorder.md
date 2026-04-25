# Task 06 — Usage recorder

**Depends on:** 01, 05
**Unblocks:** 07, 08, 09, 10

## Goal

Single-call API that writes one `usage_events` row and atomically updates the
`usage_daily` aggregate.

## Scope

New file `src/lib/usage-recorder.ts`:

```ts
export interface RecordUsageInput {
  account: Account
  modelId: string
  endpoint: 'chat.completions' | 'messages' | 'embeddings'
  upstreamFormat: 'openai' | 'anthropic'
  isStreaming: boolean
  usage: NormalizedUsage
  durationMs: number
  status: 'ok' | 'error' | 'aborted'
  requestId?: string
  isInternal?: boolean   // gate from x-internal-pricing-sync
}

export function recordUsage(input: RecordUsageInput): void
```

Behavior:

- If `isInternal === true`, return immediately (no insert).
- Look up current `model_pricing` row by `modelId`. Missing → all six
  `*_price_snapshot` columns are NULL. `premiumMultiplier` likewise → 0.
- Compute `premium_request_count = 1 * (premiumMultiplier ?? 0)`.
- In one transaction:
  1. `INSERT INTO usage_events (...)`.
  2. `INSERT INTO usage_daily (...)
       ON CONFLICT(day, account_name, model_id, endpoint)
       DO UPDATE SET req_count = req_count + 1,
                     input_tokens = input_tokens + excluded.input_tokens,
                     ...`.
- Wrap the entire body in `try/catch`; recorder errors must NOT propagate.
  Log via `consola.error`.

## Day computation

```sql
date(?ts/1000, 'unixepoch', 'localtime')
```

Use SQLite's expression so the boundary matches the user's local timezone
without dragging Node's `Intl` into the hot path.

## Definition of Done

- [ ] Unit test against in-memory DB: single insert produces 1 event row +
  1 daily row with the right counts.
- [ ] Unit test: a second insert into the same `(day, account, model,
  endpoint)` increments the daily row.
- [ ] Unit test: missing `model_pricing` row → snapshots are NULL, no throw.
- [ ] Unit test: `isInternal: true` → 0 rows inserted.
- [ ] Unit test: SQL error is swallowed; outer caller does not see exception.
