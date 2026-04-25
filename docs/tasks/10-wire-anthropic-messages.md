# Task 10 — Wire Anthropic `/v1/messages`

**Depends on:** 06
**Unblocks:** 11

## Goal

Both streaming and non-streaming Anthropic `/v1/messages` requests record one
row each, using `normalizeAnthropicMessage` or the Anthropic stream
accumulator.

## Scope

In `src/routes/messages/handler.ts` (and any proxy code that fans events to
the client):

- Non-stream: parse `response.usage` via `normalizeAnthropicMessage`.
- Stream:
  - Build an `createAnthropicAccumulator()`.
  - Feed every event passing through.
  - On `message_stop` (final event): `recordUsage(... finalize() ..., status: 'ok')`.
  - On abort: `status: 'aborted'`.
  - On error: `status: 'error'`.
- `endpoint = 'messages'`, `upstreamFormat = 'anthropic'`.

## Edge cases

- The Anthropic stream's `output_tokens` in `message_delta.usage` is
  cumulative — accumulator must track the maximum, not sum.
- Tool calls and thinking blocks: counted via `output_tokens` in the cumulative
  delta. `reasoningTokens` stays at 0 in v1.

## Definition of Done

- [ ] Non-streaming `/v1/messages` produces a row with `upstream_format =
  'anthropic'`.
- [ ] Streaming `/v1/messages` produces a row whose `output_tokens` matches
  the final `message_delta.usage.output_tokens` (not the sum of deltas).
- [ ] Cache-related fields populate `cached_input_tokens` and add into
  `input_tokens` per the rules in design doc 02.
