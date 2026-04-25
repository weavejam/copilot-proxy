# Task 16 — Dashboard upgrade

**Depends on:** 11, 13

## Goal

`pages/index.html` shows the new `stats` payload. New sub-page for the price
timeline.

## Scope

`pages/index.html`:

- Lens toggle (Historical / Current / Timeline) — controls `?lens=` on every
  fetch.
- Currency display (`stats.currency`).
- Four cards: total cost, total requests, total tokens, active accounts.
- Account × Model matrix table (cell shows tokens above, cost below).
- Daily cost stacked bar chart (color = account).
- Daily token line chart (lines = input / cached / output / reasoning).
- Missing-pricing list.

New file `pages/timeline.html`:

- Per-model step chart of `input_per_mtok`, `output_per_mtok`,
  `cached_input_per_mtok`, `reasoning_per_mtok` over time.
- Hover reveals `sync_log_id` and a JSON diff popover.
- New `/usage/timeline` route returns
  `model_pricing_versions` rows joined with `pricing_sync_log`.

Use Chart.js via CDN. No bundler.

## Definition of Done

- [ ] Three lens toggles visibly change displayed totals.
- [ ] Account × Model matrix correctly attributes tokens & cost.
- [ ] Daily charts render with at least one day of data.
- [ ] Timeline page shows a step-change at a synced price update.
- [ ] Page works against a fresh DB with zero data (empty states render
  cleanly).
