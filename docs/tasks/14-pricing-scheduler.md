# Task 14 — Scheduler + immediate first run

**Depends on:** 13
**Unblocks:** 15

## Goal

Background scheduler that runs `runPricingSync()` once at startup and then
every `--pricing-sync-interval-days` days.

## Scope

New file `src/lib/pricing-scheduler.ts`:

```ts
export function schedulePricingSync(intervalDays: number): void
```

Implementation:

```ts
const intervalMs = intervalDays * 86_400_000
function tick() {
  const last = readMeta('last_pricing_sync_ts') ?? 0
  const delay = Math.max(0, last + intervalMs - Date.now())
  setTimeout(async () => {
    try { await runPricingSync({}) }
    catch (e) { consola.warn('Pricing sync failed:', e) }
    tick()
  }, delay)
}
tick()
```

Wire it from `src/start.ts` AFTER `serve(...)`:

```ts
if (!options.pricingSyncDisabled) {
  schedulePricingSync(options.pricingSyncIntervalDays)
}
```

Add CLI flags:

- `--pricing-sync-model <id>` (default `gpt-5.4`)
- `--pricing-sync-interval-days <n>` (default `7`)
- `--pricing-sync-disabled` (default `false`)

## Definition of Done

- [ ] Booting a fresh DB triggers a sync within seconds (or fails gracefully
  if accounts/network unavailable).
- [ ] Booting with `last_pricing_sync_ts = now - 1 day` waits 6 days.
- [ ] Booting with `last_pricing_sync_ts = now - 8 days` syncs immediately.
- [ ] `--pricing-sync-disabled` skips scheduling entirely.
- [ ] Scheduler errors do NOT crash the proxy.
