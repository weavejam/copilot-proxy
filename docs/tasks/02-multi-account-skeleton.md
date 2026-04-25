# Task 02 — Multi-account skeleton

**Depends on:** 01
**Unblocks:** 03, 04, 12

## Goal

Replace the single-token `state` with an account pool. No service code uses
the new pool yet — that comes in task 03. This step delivers the
data structures, the loader, the picker, and the `acquire/release` API.

## Scope

- New file `src/lib/account-pool.ts`:
  - `Account` interface with all fields from design doc 01.
  - `AccountPool` class with `acquire()`, `release(account)`, `pickByStrategy()`,
    `markCooldown(account, ms)`, `markFailure(account)`.
- `src/lib/state.ts` becomes:
  ```ts
  export interface State {
    accounts: Account[]      // owned by AccountPool but referenced here
    pool: AccountPool
    accountType: string      // default for anonymous accounts
    strategy: 'round-robin' | 'least-busy' | 'least-recent'
    models?: ModelsResponse
    vsCodeVersion?: string
    manualApprove: boolean
    rateLimitWait: boolean
    showToken: boolean
    rateLimitSeconds?: number
  }
  ```
  Remove `githubToken`, `copilotToken`, `lastRequestTimestamp` (the last one
  moves onto `Account`).
- `src/lib/token.ts`:
  - `setupCopilotTokenFor(account)` instead of the global helper.
  - Each account starts its own refresh `setInterval`.
- New file `src/lib/accounts-loader.ts`:
  - Load `accounts.json` from `--accounts-file`.
  - Merge legacy single token (`--github-token` or `github_token` file) as
    `default` if `accounts.json` absent.
  - Seed `accounts` table on startup.
- `src/start.ts`:
  - Add flags `--accounts-file`, `--strategy`.
  - Call `loadAccounts()` then `pool.initAll()` (each account fetches its
    Copilot token in parallel via `Promise.all`).
  - Keep the current "we have a token" log line but per account.

## Picker rules

```ts
pick():
  candidates = accounts.filter(a =>
    a.copilotToken && (a.cooldownUntil ?? 0) <= now
  )
  if candidates.empty: throw "no usable account"

  switch (strategy):
    'round-robin':  return candidates[(cursor++) % candidates.length]
    'least-busy':   return min(candidates, by inFlight, then by lastUsedAt asc)
    'least-recent': return min(candidates, by lastUsedAt asc)
```

## Definition of Done

- [ ] Booting with no `accounts.json` still works (legacy single token).
- [ ] Booting with two-account `accounts.json` logs two refresh loops.
- [ ] Each account has its own `copilotToken` after startup.
- [ ] Unit test: `AccountPool` picker returns least-busy when one account is
  artificially in-flight.
- [ ] Unit test: cooldown account is excluded; on cooldown expiry it returns.
