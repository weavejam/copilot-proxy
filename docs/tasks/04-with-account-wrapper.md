# Task 04 — Handler `withAccount` wrapper

**Depends on:** 03
**Unblocks:** 07, 08, 09, 10

## Goal

Replace the inline `acquire/release` placeholder from task 03 with a single
`withAccount` helper that handles retry, cooldown, abort, and the
`x-internal-pricing-sync` exemption.

## Scope

New file `src/lib/with-account.ts`:

```ts
export async function withAccount<T>(
  c: Context,
  fn: (account: Account) => Promise<T>,
): Promise<T> {
  const isInternal = c.req.header('x-internal-pricing-sync') === '1'
  const maxRetries = Math.min(state.pool.size(), 3)
  let lastErr: unknown
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const account = await state.pool.acquire()
    try {
      const out = await fn(account)
      account.consecutiveFailures = 0
      return out
    } catch (e) {
      lastErr = e
      if (isClientError(e)) throw e             // 4xx (non-401) — no retry
      if (isAuthError(e))   triggerRefresh(account) // 401 — refresh, then retry
      else                  state.pool.markCooldown(account, 30_000) // 5xx / network
    } finally {
      state.pool.release(account)
    }
  }
  throw lastErr
}
```

Update each handler to:

```ts
return withAccount(c, async (account) => {
  // ...existing logic with `account` threaded into service call...
})
```

Streaming handlers must not retry once the SSE response has begun flushing.
Either:

- Detect "headers already sent" and rethrow without rotating, OR
- Wrap retry only around the `fetch()` upstream call, and once events start
  flowing, abort retry.

## Definition of Done

- [ ] `withAccount` is the only place that calls `pool.acquire/release`
  outside startup code.
- [ ] Unit test: forcing a 401 once causes one retry against a different
  account (use a dummy pool of two accounts).
- [ ] Unit test: forcing a 4xx never retries.
- [ ] Manual smoke: kill one account's token mid-flight; new requests succeed
  on the other account; the dead account enters cooldown.
- [ ] Internal `x-internal-pricing-sync: 1` requests bypass nothing in this
  task (the exemption only matters for the recorder in task 06).
