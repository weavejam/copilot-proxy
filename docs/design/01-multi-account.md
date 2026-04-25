# 01 — Multi-Account Login & Token Rotation

## Goal

Hold N GitHub tokens at once; for every inbound request pick the **currently
least-busy** account so concurrent traffic parallelizes across accounts.

## Account model

```ts
interface Account {
  name: string                  // unique key
  accountType: string           // 'individual' | 'business' | 'enterprise'
  githubToken: string
  copilotToken?: string
  copilotTokenExpiresAt?: number
  refreshTimer?: NodeJS.Timer
  inFlight: number              // running request counter
  cooldownUntil?: number        // upstream backoff
  lastUsedAt: number
  consecutiveFailures: number
}
```

The global `state` exposes `accounts: Account[]` plus `strategy` and a
round-robin cursor.

## Configuration

`~/.local/share/copilot-api/accounts.json`:

```json
{
  "accounts": [
    { "name": "msft-1", "githubToken": "ghu_xxx", "accountType": "individual" },
    { "name": "msft-2", "githubToken": "ghu_yyy", "accountType": "business" }
  ],
  "strategy": "least-busy"
}
```

Backwards compatibility:

- `--github-token` and the legacy single-file `github_token` continue to work.
  At startup they are merged into the accounts array as a single anonymous
  account named `default`.

## Strategies

- `round-robin` — cursor; simplest; will still hit a slow account.
- `least-busy` _(default)_ — pick the account with smallest `inFlight`; ties
  broken by oldest `lastUsedAt`. Best fit for the latency-reduction goal.
- `least-recent` — oldest `lastUsedAt` first; gives smoother distribution for
  short bursty traffic.

Picker filters out accounts with `cooldownUntil > now` or no valid
`copilotToken`.

## Account pool API

```ts
const account = await pool.acquire()      // pick + inFlight++
try {
  return await fn(account)
} finally {
  pool.release(account)                   // inFlight--, lastUsedAt = now
}
```

JavaScript is single-threaded, so `inFlight++/--` need no locks. **The
critical correctness rule**: every code path — normal completion, thrown
exception, client abort, stream end — must hit `release`. For streaming
responses `release` runs after the SSE generator finishes or the request
signal aborts.

## Refresh & failure semantics

- Each account refreshes its Copilot token on its own `setInterval`
  (`refresh_in - 60`s). The closure captures the account reference.
- Refresh failure on account A: log warn, set `cooldownUntil = now + 5min`,
  do not crash.
- Upstream 401/403: invalidate `copilotToken` for that account, trigger an
  immediate refresh, retry the request on the **next** account (max
  `min(accounts.length, 3)` retries).
- Upstream 5xx / network error: 30s cooldown, retry on next account.
- Upstream 4xx (client error): pass through, no retry, no cooldown.

## Per-account rate limiting

`state.lastRequestTimestamp` becomes `account.lastRequestTimestamp`.
`checkRateLimit(account)` operates per account. Most users running this
multi-account feature will not enable `--rate-limit` at all — the rotation
itself is the spread.

## Service-layer signature changes

All upstream-calling helpers receive an `Account` instead of reading the
global `state.copilotToken`:

```ts
copilotHeaders(account, vision?)
copilotBaseUrl(account)
githubHeaders(account)              // for GitHub API calls
createChatCompletions(account, payload)
createEmbeddings(account, payload)
getCopilotUsage(account)
```

The `state` global keeps non-account-specific things only
(`models`, `vsCodeVersion`, `manualApprove`, `showToken`, etc.).

## Internal-call marker

Some flows call the proxy's own `/v1/chat/completions` (notably the pricing
sync task). Those requests carry header `x-internal-pricing-sync: 1`. The
recorder MUST skip writing a `usage_event` for any inbound request bearing
this header — otherwise the proxy bills itself weekly.

## CLI

| Flag | Default | Notes |
|---|---|---|
| `--accounts-file <path>` | `~/.local/share/copilot-api/accounts.json` | |
| `--strategy <name>` | `least-busy` | `round-robin` \| `least-busy` \| `least-recent` |

`auth` subcommand gains `--name <id>` and appends to `accounts.json`.

## Known sharp edges

- Streams hold an account's `inFlight` for the entire response duration. This
  is correct: long streams should make the picker steer new traffic away.
- If a client opens many streaming connections faster than accounts can drain,
  `least-busy` degenerates to round-robin. Acceptable.
- `pickAccount` assumes JavaScript single-thread. Do not introduce worker
  threads for upstream I/O without revisiting the locking model.
