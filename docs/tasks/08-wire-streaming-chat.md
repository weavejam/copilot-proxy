# Task 08 — Wire streaming chat completions

**Depends on:** 07
**Unblocks:** 11

## Goal

Streaming OpenAI requests record one row each, with usage extracted from
the final `include_usage` chunk. Aborts produce a `status = 'aborted'` row
with whatever was accumulated.

## Scope

In `create-chat-completions.ts`:

- Before forwarding `payload` upstream, when `payload.stream === true`,
  ensure `payload.stream_options = { ...payload.stream_options, include_usage: true }`.
- Wrap the `events()` async iterator with a `StreamUsageAccumulator`:
  - `feed(chunk)` for every event.
  - On normal completion: `recordUsage(... finalize() ...)` with `status = 'ok'`.
  - On `c.req.raw.signal.aborted`: stop forwarding, `recordUsage(...)` with
    `status = 'aborted'` and the partial usage.
  - On thrown error after streaming started: `status = 'error'` with partial
    usage.

Frame stripping (optional, gated by `--strip-usage-frame`, default off):
the final `choices: []` chunk gets dropped before flushing to the client.

## Edge cases

- Some clients send their own `stream_options.include_usage`. Override with
  `true` if they sent `false` — they likely just don't know the proxy needs
  it. Log at `debug` level.
- Tool-call streams: token accounting is identical; the `usage` final chunk
  still arrives.
- If the upstream closes without ever sending the usage chunk:
  `accumulator.finalize()` throws; record a `status = 'error'` event with
  zero usage and log a warn.

## Definition of Done

- [ ] Manual smoke: streaming curl request produces 1 row with non-zero
  `output_tokens`.
- [ ] Manual smoke: ctrl-C mid-stream → row with `status = 'aborted'`.
- [ ] Verify with a client that does NOT send `include_usage` — proxy still
  records.
- [ ] `--strip-usage-frame` removes the final empty-choices chunk from the
  client response.
