# Task 07 — Wire non-streaming chat completions

**Depends on:** 03, 04, 06
**Unblocks:** 11

## Goal

The simplest end-to-end recorder integration: a non-streaming OpenAI
chat-completions request results in exactly one `usage_events` row with
populated token counts and price snapshots.

## Scope

In `src/services/copilot/create-chat-completions.ts` and
`src/routes/chat-completions/handler.ts`:

- Capture `tStart = Date.now()` at the beginning of the handler.
- After a successful non-streaming response, call `recordUsage` with:
  - `usage = normalizeOpenAIFinal(response.usage)`
  - `endpoint = 'chat.completions'`
  - `upstreamFormat = 'openai'`
  - `isStreaming = false`
  - `status = 'ok'`
  - `durationMs = Date.now() - tStart`
  - `requestId = response.id`
  - `isInternal = c.req.header('x-internal-pricing-sync') === '1'`
- On thrown error before `recordUsage`: best-effort write a `status = 'error'`
  event with zero usage. Skip on missing model.

Streaming branch: untouched in this task (task 08 owns it).

## Definition of Done

- [ ] Manual smoke: send a non-streaming request via curl; observe 1 row in
  `usage_events` and 1 / +1 in `usage_daily`.
- [ ] Repeat with two accounts; verify `account_name` reflects the chosen
  account.
- [ ] No regression in the streaming path.
- [ ] `isInternal` request (header set) does not produce a row.
