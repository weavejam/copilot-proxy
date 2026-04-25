# Task 09 — Wire embeddings

**Depends on:** 06
**Unblocks:** 11

## Goal

Embedding calls record `usage_events` rows with `endpoint = 'embeddings'`.

## Scope

In `src/services/copilot/create-embeddings.ts` and the embeddings route
handler:

- `recordUsage` with:
  - `endpoint = 'embeddings'`
  - `upstreamFormat = 'openai'`
  - `isStreaming = false`
  - `usage = normalizeEmbeddings(response.usage)`
- Output / reasoning / cached input columns are zero by definition.

Pricing for embedding models reuses `model_pricing.input_per_mtok`. No new
columns.

## Definition of Done

- [ ] Manual smoke: a `/v1/embeddings` request produces a row with
  `endpoint = 'embeddings'`, `output_tokens = 0`, and `input_tokens > 0`.
- [ ] `usage_daily` aggregates separately from `chat.completions` for the
  same model (different `endpoint` PK component).
