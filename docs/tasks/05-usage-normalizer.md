# Task 05 — Usage normalizer + stream accumulators

**Depends on:** —
**Unblocks:** 06

## Goal

Pure modules that turn upstream usage payloads (OpenAI / Anthropic) into a
common `NormalizedUsage`. No DB, no network, no `state` — easy to unit test.

## Scope

New file `src/lib/usage-normalizer.ts`:

```ts
export interface NormalizedUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}

export function normalizeOpenAIFinal(usage: unknown): NormalizedUsage
export function normalizeAnthropicMessage(message: unknown): NormalizedUsage
export function normalizeEmbeddings(usage: unknown): NormalizedUsage

export interface StreamUsageAccumulator {
  feed(chunk: unknown): void
  finalize(): NormalizedUsage    // throws if upstream never delivered usage
}

export function createOpenAIAccumulator(): StreamUsageAccumulator
export function createAnthropicAccumulator(): StreamUsageAccumulator
```

### OpenAI accumulator

- Watches every chunk for `chunk.usage`. The `include_usage` final chunk has
  `choices: []` and a populated `usage`. Save it.
- `finalize()` returns `normalizeOpenAIFinal(saved)` or throws
  `UsageMissingError`.

### Anthropic accumulator

- `feed` switches on `chunk.type`:
  - `message_start` → record `message.usage.input_tokens`,
    `cache_read_input_tokens`, `cache_creation_input_tokens`.
  - `message_delta` → `outputTokens = max(outputTokens, chunk.usage.output_tokens)`.
- `finalize()` builds `NormalizedUsage`. Anthropic always emits at least one
  `message_delta` for non-trivial responses; if not, return zeros (do not throw).

### Field rules (from design doc 02)

- Anthropic `cache_creation_input_tokens` is added to `inputTokens` (not a
  separate column).
- OpenAI `completion_tokens` already includes reasoning — do not double-count.
  `reasoningTokens` is informational only; cost calc against `outputTokens`.

## Definition of Done

- [ ] Unit tests per format: typical chunk sequence → expected `NormalizedUsage`.
- [ ] Edge case: OpenAI accumulator without `include_usage` chunk → throws.
- [ ] Edge case: Anthropic stream that ends after `message_start` only →
  returns sane zeros for output.
- [ ] No imports of `state`, `db`, or `consola`.
