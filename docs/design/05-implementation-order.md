# 05 — Implementation Order

The 16-step plan, ordered for **minimum coupling per step**. Each step lands
green tests / a runnable proxy and unblocks the next ones. The GitHub Project
tasks are derived 1:1 from this list — see `docs/tasks/`.

| # | Step | Touches | Unblocks |
|---|---|---|---|
| 1 | DB module + migrations + meta | `src/lib/db.ts` (new) | 2, 6 |
| 2 | Multi-account skeleton | `src/lib/state.ts`, `src/lib/account-pool.ts` (new), `src/lib/token.ts`, `src/start.ts`, accounts.json loader | 3, 4, 12 |
| 3 | Service-layer token threading | `src/lib/api-config.ts`, `src/services/**` | 4, 7-10 |
| 4 | Handler `withAccount` wrapper | `src/routes/**/handler.ts` | 7-10 |
| 5 | Usage normalizer + accumulators | `src/lib/usage-normalizer.ts` (new) + tests | 6 |
| 6 | Usage recorder | `src/lib/usage-recorder.ts` (new) | 7-10 |
| 7 | Wire non-streaming chat completions | `src/services/copilot/create-chat-completions.ts`, `src/routes/chat-completions/handler.ts` | 11 |
| 8 | Wire streaming chat completions (inject `include_usage`, abort handling) | same as 7 | 11 |
| 9 | Wire embeddings | `src/services/copilot/create-embeddings.ts`, `src/routes/embeddings/**` | 11 |
| 10 | Wire Anthropic `/v1/messages` (stream + non-stream) | `src/routes/messages/**` | 11 |
| 11 | `/usage` route extension (3 lenses, query params, missing_pricing) | `src/routes/usage/route.ts` | 16 |
| 12 | Pricing sync core (Azure + Anthropic fetch + LLM call + validators) | `src/lib/pricing-sync.ts` (new), `src/lib/pricing-sources.ts` (new) | 13 |
| 13 | Version write logic (sanity, change threshold, version append, current upsert) | `src/lib/pricing-sync.ts` | 14 |
| 14 | Scheduler + immediate first run | `src/lib/pricing-scheduler.ts` (new), `src/start.ts` | 15 |
| 15 | `pricing-sync` subcommand | `src/main.ts`, `src/pricing-sync.ts` (new) | 16 |
| 16 | Dashboard upgrade (3-lens toggle, matrix, charts, price timeline page) | `pages/index.html` (+ optional `pages/timeline.html`) | — |

## Dependency rationale

- **1 before 2** so accounts table exists when the loader seeds it.
- **2 before 3** so `Account` type exists before service signatures change.
- **3 before 4** because handlers wrap service calls, not the other way.
- **5 before 6** because the recorder consumes a `NormalizedUsage`.
- **6 before 7-10** because every wire step calls the recorder.
- **7-10 are parallelizable** once 6 is green; merge order is flexible.
- **11 depends only on data being recorded** — does not need 12-15.
- **12-13-14-15 are a linear chain** for the pricing pipeline.
- **16 needs 11 to ship the `/usage` shape** and at least 13 to populate
  `model_pricing` so the UI has prices to render. It can ship as soon as
  both are in.

## Definition of Done per step

Each task ticket carries a checklist:

- [ ] Code change merged
- [ ] Unit tests for new pure modules (normalizer, sanity, change threshold)
- [ ] Manual smoke against `bun run dev` covering the touched endpoint
- [ ] No regression in existing endpoints (curl the legacy path)
- [ ] Updated `AGENTS.md` and design docs if behavior diverges from this plan

## Out of scope for v1

- Multi-tenant DB isolation
- Real-time websockets to push usage to the dashboard
- Cost forecasting / anomaly detection
- Auto-rotation of GitHub tokens (re-running device flow on expiry)
