# 04 — CLI & Config

## New CLI flags on `start`

| Flag | Default | Description |
|---|---|---|
| `--accounts-file <path>` | `~/.local/share/copilot-api/accounts.json` | Multi-account config |
| `--strategy <name>` | `least-busy` | `round-robin` / `least-busy` / `least-recent` |
| `--db-path <path>` | `~/.local/share/copilot-api/usage.sqlite` | Usage DB |
| `--pricing-sync-model <id>` | `gpt-5.4` | LLM used by the sync task |
| `--pricing-sync-interval-days <n>` | `7` | Interval; first run is immediate |
| `--pricing-sync-disabled` | `false` | Skip the auto sync loop |
| `--strip-usage-frame` | `false` | Hide the injected `usage` final chunk from clients |

Existing flags (`--port`, `--verbose`, `--account-type`, `--manual`,
`--rate-limit`, `--wait`, `--github-token`, `--claude-code`, `--show-token`,
`--proxy-env`) keep their semantics. `--account-type` becomes the default
applied to anonymous accounts loaded via `--github-token` or the legacy
single-token file. `accounts.json` entries override per-account.

## New CLI flags on `auth`

| Flag | Default | Description |
|---|---|---|
| `--name <id>` | _(prompt)_ | Append a named entry to `accounts.json` |
| `--account-type <type>` | `individual` | Set account type for the new entry |

If `--name` is omitted, prompt interactively. If `accounts.json` does not
exist, create it.

## New subcommand

| Command | Description |
|---|---|
| `pricing-sync` | Run a single sync pass and exit. Honors `--pricing-sync-model` and the same DB / accounts-file flags. Useful for first-time bootstrap and CI. |

## Config file format — `accounts.json`

```json
{
  "accounts": [
    { "name": "msft-1", "githubToken": "ghu_xxx", "accountType": "individual" },
    { "name": "msft-2", "githubToken": "ghu_yyy", "accountType": "business"   }
  ],
  "strategy": "least-busy"
}
```

- `name` must be unique within the file.
- `accountType` defaults to `individual`.
- `strategy` is optional; if absent, falls back to `--strategy` then to
  `least-busy`.
- File is created with mode `0600` if the proxy writes to it.

## Backwards compatibility matrix

| Existing input | Behavior with new code |
|---|---|
| `--github-token ghp_xxx` | Loaded as a single anonymous account named `default` |
| `~/.local/share/copilot-api/github_token` non-empty | Loaded as `default` if `accounts.json` is absent |
| Both legacy file _and_ `accounts.json` exist | `accounts.json` wins; legacy file is ignored with a warn |
| Existing `pages/index.html` URL bookmarks | Still work; the legacy `quota` field is preserved in `/usage` response |

## Environment variables

No new env vars are introduced for v1. The existing `GH_TOKEN` / proxy-env
behavior is unchanged.
