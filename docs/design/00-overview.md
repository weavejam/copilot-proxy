# Multi-Account & Usage Billing — Design Overview

This document set describes a feature pack to add to copilot-api:

1. **Multi-account login & token rotation** — load N GitHub tokens, route each
   inbound request to the least-busy account so concurrent traffic actually
   parallelizes (instead of serializing through one account's upstream queue).
2. **Per-account / per-model usage accounting** — record input / cached input /
   output / reasoning tokens for every request into SQLite.
3. **Dual-pricing cost reporting** — render cost in both _token-priced_ and
   _premium-request_ ledgers; swap on the dashboard.
4. **Self-syncing pricing table** — a weekly background task pulls Azure Retail
   Prices + Anthropic public pricing, asks the proxy's own LLM to normalize
   them into the proxy's model IDs, and appends new versions whenever a price
   actually changes.
5. **Dashboard upgrade** — three cost lenses (_historical snapshot_,
   _current price_, _timeline price_), an account × model matrix, daily trend
   charts, and a price-change timeline.

## Why

The user runs an internal Microsoft account with effectively unlimited Copilot
quota. Latency from a single account is the bottleneck. Multi-account load
balancing parallelizes outbound calls and lowers tail latency. Detailed
billing makes internal cost attribution possible.

## Non-goals

- Bypassing GitHub's abuse-detection or rate-limits for accounts that _are_
  rate-limited. The whole feature pack is justified by latency, not quota.
- Real-time streaming charts. Daily roll-up is enough.
- Multi-tenant usage data isolation. One DB serves the whole proxy instance.

## Document map

- `01-multi-account.md` — account pool, scheduling strategy, auth flow,
  per-request lifecycle.
- `02-usage-accounting.md` — DB schema (events + daily roll-up), normalizer
  per upstream format, recorder transactional behavior.
- `03-pricing-and-sync.md` — pricing schema, version timeline, sync task,
  validators, three cost lenses, dashboard.
- `04-cli-and-config.md` — every new CLI flag, config file format, defaults.
- `05-implementation-order.md` — the 16-step ordered plan that the GitHub
  Project tasks are derived from.

## Frozen decisions

| Topic | Value |
|---|---|
| Pricing storage | Plan C — events store token counts + price snapshots; cost computed at read time |
| Cost lenses | Historical (snapshot) / Current (latest) / Timeline (per-event ts → version) |
| Streaming usage | Force-inject `stream_options.include_usage=true` for OpenAI; Anthropic native |
| Granularity | Per-request `usage_events` + materialized `usage_daily` |
| Embeddings | Counted, distinguished by `endpoint` column |
| DB path | `~/.local/share/copilot-api/usage.sqlite` |
| Pricing source | Azure Retail Prices API + anthropic.com/pricing |
| Sync LLM | Calls own proxy `/v1/chat/completions`; default model `gpt-5.4`; falls back to a hard-coded whitelist |
| Sync interval | `--pricing-sync-interval-days`, default 7; first run kicked off in background on startup |
| Sanity check | Single field relative change > 10× → reject the entire sync |
| Change threshold | Single field relative change < 0.5% → no new version row |
| `effective_from` | `detected_at` (sync commit timestamp); Azure-supplied timestamps not stored |
| Event traceability | No `pricing_version_id` FK; rely solely on `*_price_snapshot` columns |
| Rotation strategy default | `least-busy` |

These are locked. Do not relitigate them inside individual task tickets.
