# Task 11 — `/usage` route extension

**Depends on:** 06 (and ideally 07–10 for real data, but it can ship earlier)
**Unblocks:** 16

## Goal

`/usage` returns the legacy `quota` payload AND a new `stats` payload with
three cost lenses, query-param filtering, and a `missing_pricing` list.

## Scope

`src/routes/usage/route.ts` accepts these query params:

- `from` / `to` — millisecond timestamps; default last 30 days
- `account` — filter to one account name
- `model` — filter to one model id
- `endpoint` — filter to one of the three endpoint values
- `group` — `day` | `model` | `account` | `endpoint` (default `day`)
- `lens` — `historical` | `current` | `timeline` (default `historical`)

Response shape: see design doc 03 §`/usage` route.

## SQL templates

Three pre-built statements per lens. The `WHERE` clause is composed from the
filter params; bind variables only — never string-interpolate user input.

`missing_pricing`:

```sql
SELECT DISTINCT model_id
FROM usage_events
WHERE model_id NOT IN (SELECT model_id FROM model_pricing)
  AND ts BETWEEN ? AND ?;
```

`quota`:

- For each account in the pool, call `getCopilotUsage(account)`.
- Return a list under `quota.byAccount`. Keep a top-level `quota` field as
  the merged / fan-out summary for backwards compat — pick the first
  account's payload if a single object is needed.

## Definition of Done

- [ ] `curl /usage` without params returns both `quota` and `stats`.
- [ ] `?lens=current` shows different totals than `?lens=historical` after a
  pricing sync that changed prices.
- [ ] `?from=&to=` correctly bounds the dataset.
- [ ] `?group=model` returns rows keyed by model.
- [ ] Existing dashboard URL `pages/index.html?endpoint=...` still loads (it
  ignores the new `stats` field gracefully — task 16 will use it).
