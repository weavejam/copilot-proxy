# Task 03 — Service-layer token threading

**Depends on:** 02
**Unblocks:** 04, 07, 08, 09, 10

## Goal

All upstream-calling helpers receive an `Account` instead of reading from a
global. After this task, the proxy still works exactly as before because
handlers will pass `state.pool.acquire()` once and forward the result — the
real load balancing happens in task 04.

## Scope

Change signatures in `src/lib/api-config.ts`:

```ts
copilotBaseUrl(account)
copilotHeaders(account, vision?)
githubHeaders(account)
```

Change signatures in:

- `src/services/copilot/create-chat-completions.ts`
- `src/services/copilot/create-embeddings.ts`
- `src/services/copilot/get-models.ts`
- `src/services/github/get-copilot-token.ts`
- `src/services/github/get-copilot-usage.ts`
- `src/services/github/get-user.ts`

Each function takes `account` as its first arg (or as part of an options bag).

Handlers are updated to acquire an account inline (interim placeholder before
task 04):

```ts
const account = await state.pool.acquire()
try {
  return await createChatCompletions(account, payload)
} finally {
  state.pool.release(account)
}
```

## Definition of Done

- [ ] `tsc` passes; no remaining references to `state.copilotToken` or
  `state.githubToken`.
- [ ] All existing tests / manual smoke against the OpenAI and Anthropic
  endpoints still pass.
- [ ] `cacheModels()` / `cacheVSCodeVersion()` updated to call the per-account
  variant (use the first available account; these are startup-time concerns).
