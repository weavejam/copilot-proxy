# 02 — Usage Accounting

## Goal

Every inbound chat / messages / embeddings call writes one row to
`usage_events` and increments the corresponding `usage_daily` row inside the
same transaction. Token counts are stored raw; per-token unit prices are
stored as a snapshot for stable historical reporting.

## Schema (the relevant tables)

```sql
CREATE TABLE accounts (
  name TEXT PRIMARY KEY,
  account_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  account_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,                -- 'chat.completions' | 'messages' | 'embeddings'
  upstream_format TEXT NOT NULL,         -- 'openai' | 'anthropic'
  is_streaming INTEGER NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  cached_input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  premium_request_count REAL DEFAULT 0,
  input_price_snapshot REAL,
  cached_input_price_snapshot REAL,
  output_price_snapshot REAL,
  reasoning_price_snapshot REAL,
  premium_unit_price_snapshot REAL,
  premium_multiplier_snapshot REAL,
  request_id TEXT,
  status TEXT NOT NULL,                  -- 'ok' | 'error' | 'aborted'
  duration_ms INTEGER,
  FOREIGN KEY (account_name) REFERENCES accounts(name)
);
CREATE INDEX idx_usage_account_model_ts ON usage_events(account_name, model_id, ts);
CREATE INDEX idx_usage_ts ON usage_events(ts);

CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  account_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  req_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  premium_requests REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, account_name, model_id, endpoint)
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

`usage_daily` only aggregates token counts. Cost is computed at read time so
that price changes on `model_pricing_versions` flow into reports
automatically (when the user picks the timeline lens).

## Driver

Use `bun:sqlite` (the project already runs on Bun). Synchronous,
zero-dependency, fast enough.

DB path: `~/.local/share/copilot-api/usage.sqlite`. Migrations driven by
`meta.schema_version` (start at `1`). `journal_mode = WAL`.

## Normalizer

A single function `normalizeUsage(format, payload)` produces:

```ts
type NormalizedUsage = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}
```

### OpenAI (non-streaming response or streaming final chunk)

- `usage.prompt_tokens` → `inputTokens`
- `usage.prompt_tokens_details.cached_tokens` → `cachedInputTokens`
- `usage.completion_tokens` → `outputTokens` (this number already includes
  reasoning tokens — do NOT add them again)
- `usage.completion_tokens_details.reasoning_tokens` → `reasoningTokens`
  (informational; cost should be computed against `outputTokens`, with
  `reasoningTokens` only used when a model has a separate reasoning rate)
- `totalTokens = prompt_tokens + completion_tokens`

### Anthropic (`/v1/messages`)

- `message_start.message.usage.input_tokens` → `inputTokens`
- `message_start.message.usage.cache_read_input_tokens` → `cachedInputTokens`
- `message_start.message.usage.cache_creation_input_tokens` → add to
  `inputTokens` (no separate column)
- `message_delta.usage.output_tokens` is **cumulative**; take the maximum
  observed value as `outputTokens`
- `reasoningTokens = 0` unless we explicitly count thinking blocks via
  tokenizer (out of scope for v1)

### Embeddings

- `usage.prompt_tokens` → `inputTokens`; everything else 0.

## Streaming usage extraction

OpenAI streaming **does not return `usage` by default**. The proxy must inject
`stream_options: { include_usage: true }` into every outbound chat-completion
request when `payload.stream === true`. The injected final chunk has
`choices: []` and a populated `usage`. Most clients tolerate it; if a client
breaks, gate this with `--strip-usage-frame` (default off).

A `StreamUsageAccumulator` class encapsulates the state machine. Two flavors
(OpenAI vs Anthropic) implement a common interface:

```ts
class StreamUsageAccumulator {
  feed(chunk: unknown): void
  finalize(): NormalizedUsage    // throws if upstream closed without usage
}
```

Abort handling: subscribe to `c.req.raw.signal`. On abort, call
`finalize()` with whatever was accumulated so far and write a row with
`status = 'aborted'`.

## Recorder

`recordUsage` runs in one transaction:

```ts
recordUsage({
  account, modelId, endpoint, upstreamFormat, isStreaming,
  usage: NormalizedUsage,
  premiumMultiplier,           // from model_pricing.premium_multiplier
  durationMs, status, requestId,
}): void
```

Steps:

1. Look up `model_pricing` row (current snapshot) for `modelId`. If absent,
   all `*_price_snapshot` columns are written as `NULL`.
2. Compute `premium_request_count = 1 * (premiumMultiplier ?? 0)`.
3. `INSERT INTO usage_events (...)`.
4. `INSERT INTO usage_daily (...) ON CONFLICT(day, account_name, model_id,
   endpoint) DO UPDATE SET req_count = req_count + 1,
   input_tokens = input_tokens + excluded.input_tokens, ...`.
5. Commit.

`day` is computed in local time: `date(ts/1000, 'unixepoch', 'localtime')`.

## Internal-call exemption

`recordUsage` MUST be skipped if the original request carried
`x-internal-pricing-sync: 1`. The handler must thread that header into the
recorder call site (or just gate the call there).

## Failure isolation

Recorder errors must not break user requests. Wrap the entire `recordUsage`
call site in `try { ... } catch (e) { consola.error(...) }`. Best-effort
accounting; never let it bubble.
