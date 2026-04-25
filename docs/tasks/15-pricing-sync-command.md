# Task 15 — `pricing-sync` subcommand

**Depends on:** 13
**Unblocks:** 16 (operationally; not strictly)

## Goal

A standalone CLI subcommand that runs one sync pass without starting the
HTTP server. Useful for first-time bootstrap, CI, and debugging.

## Scope

New file `src/pricing-sync.ts`:

```ts
export const pricingSyncCommand = defineCommand({
  meta: { name: 'pricing-sync', description: 'Run a single pricing sync pass' },
  args: {
    'accounts-file':           { ... },
    'db-path':                 { ... },
    'pricing-sync-model':      { default: 'gpt-5.4' },
    verbose:                   { default: false },
    'show-token':              { default: false },
  },
  async run({ args }) {
    initDb(args['db-path'])
    await loadAccounts(args['accounts-file'])
    await pool.initAll()             // fetch Copilot tokens
    await cacheModels(pool.first())
    const result = await runPricingSync({ syncModel: args['pricing-sync-model'] })
    consola.success(`Sync ${result.status}: updated=${result.updated}, rejected=${result.rejected}`)
  }
})
```

Register in `src/main.ts` next to the existing subcommands.

## Definition of Done

- [ ] `bun run dev pricing-sync` works end-to-end against a real account.
- [ ] Exits 0 on `'ok'` and `'partial'`, non-zero on `'rejected'` and
  `'failed'`.
- [ ] Without an HTTP server running, the sync still completes (it calls
  the LLM via in-process function call, NOT via localhost — implementer
  may either bypass HTTP or spin up a temporary listener; bypass is simpler).

> Note on the "self-call via HTTP" pattern: for the `start` command path the
> sync uses `http://localhost:<port>/v1/chat/completions` as documented. For
> `pricing-sync` standalone there is no server, so call
> `createChatCompletions(pool.acquire(), payload)` directly. Both paths must
> set `x-internal-pricing-sync: 1` on the request context so the recorder
> exemption fires (and the recorder MUST gate on the call site, not just on
> the HTTP header).
