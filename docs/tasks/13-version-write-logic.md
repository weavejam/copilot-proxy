# Task 13 — Version-write logic

**Depends on:** 12
**Unblocks:** 14

## Goal

Glue task 12's parsed output into the database with the version-timeline
semantics. This is the only task that writes to `model_pricing` and
`model_pricing_versions`.

## Scope

In `src/lib/pricing-sync.ts`:

```ts
export async function runPricingSync(opts: {
  syncModel?: string,
}): Promise<{ status: SyncStatus; updated: number; rejected: number }>
```

Body:

1. `req = await buildSyncRequest()`.
2. `parsed = await callSyncLlm(req, pickSyncModel(...))`.
3. Per-row sanity gate — if any row fails sanity, set
   `status = 'rejected'` and skip writes.
4. In one transaction:
   - Insert `pricing_sync_log` row with `status = 'pending'` (or write at end
     with the final status — implementer's call).
   - For each accepted row:
     - Look up current `model_pricing_versions.* WHERE effective_to IS NULL`.
     - If `priceChanged()` is false: skip (no version row).
     - Else: `UPDATE versions SET effective_to = ?detectedAt WHERE id = old.id`,
       `INSERT versions (effective_from = ?detectedAt, effective_to = NULL,
       sync_log_id = ?logId, ...)`.
     - `UPSERT model_pricing` with the new row.
   - Update `meta.last_pricing_sync_ts`.
   - Finalize `pricing_sync_log` row.

Status values:

- `'ok'`: at least one update, zero rejections, no sanity failures
- `'partial'`: some rejections OR partial coverage of `knownModels`
- `'rejected'`: sanity gate triggered, no DB writes
- `'failed'`: fetch / LLM / validator error

## Definition of Done

- [ ] Unit / integration test against in-memory DB:
  - First sync inserts version rows for each model.
  - Second sync with identical prices makes zero new version rows.
  - Second sync with one changed price patches the old `effective_to`
    and inserts one new version.
  - A 10x change anywhere causes `'rejected'` and zero DB mutations.
- [ ] Sync is idempotent: rerunning immediately after a successful sync is a
  no-op.
