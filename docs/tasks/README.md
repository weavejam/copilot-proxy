# Tasks Index

The 16 implementation tasks derived from `../design/05-implementation-order.md`.
Each task is a standalone unit of work with explicit dependencies.

| # | Title | Depends on | Unblocks |
|---|---|---|---|
| 01 | DB module + migrations + meta | — | 02, 06 |
| 02 | Multi-account skeleton | 01 | 03, 04, 12 |
| 03 | Service-layer token threading | 02 | 04, 07–10 |
| 04 | Handler `withAccount` wrapper | 03 | 07–10 |
| 05 | Usage normalizer + accumulators | — | 06 |
| 06 | Usage recorder | 01, 05 | 07–10 |
| 07 | Wire non-streaming chat completions | 03, 04, 06 | 11 |
| 08 | Wire streaming chat completions | 07 | 11 |
| 09 | Wire embeddings | 06 | 11 |
| 10 | Wire Anthropic `/v1/messages` | 06 | 11 |
| 11 | `/usage` route extension | 06 | 16 |
| 12 | Pricing sync core | 02 | 13 |
| 13 | Version-write logic | 12 | 14 |
| 14 | Scheduler + immediate first run | 13 | 15 |
| 15 | `pricing-sync` subcommand | 13 | 16 (operationally) |
| 16 | Dashboard upgrade | 11, 13 | — |

## Parallelizable groups

After task 06 lands, tasks 07–10 can be done in parallel.
After task 02 lands, task 12 can run in parallel with the 03→04 chain.
After task 11 and task 13 both land, task 16 can start.
