# Copilot API Proxy

> [!WARNING]
> This is a reverse-engineered proxy of GitHub Copilot API. It is not supported by GitHub, and may break unexpectedly. Use at your own risk.

> [!WARNING]
> **GitHub Security Notice:**
> Excessive automated or scripted use of Copilot (including rapid or bulk requests, such as via automated tools) may trigger GitHub's abuse-detection systems.
> You may receive a warning from GitHub Security, and further anomalous activity could result in temporary suspension of your Copilot access.
>
> GitHub prohibits use of their servers for excessive automated bulk activity or any activity that places undue burden on their infrastructure.
>
> Please review:
>
> - [GitHub Acceptable Use Policies](https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github)
> - [GitHub Copilot Terms](https://docs.github.com/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)
>
> Use this proxy responsibly to avoid account restrictions.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E519XS7W)

---

**Note:** If you are using [opencode](https://github.com/sst/opencode), you do not need this project. Opencode supports GitHub Copilot provider out of the box.

---

## Overview

A reverse-engineered proxy for the GitHub Copilot API that exposes it as an **OpenAI** and **Anthropic** compatible service. Use GitHub Copilot with any tool that supports the OpenAI Chat Completions API or the Anthropic Messages API — including [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

## Features

- **OpenAI & Anthropic Compatible API** — `/v1/chat/completions`, `/v1/models`, `/v1/embeddings`, `/v1/messages`, `/v1/messages/count_tokens`
- **Claude Code Integration** — One-command setup with `--claude-code`, or manual `settings.json` configuration
- **Multi-Account & Load Balancing** — Configure multiple GitHub accounts with round-robin, least-busy, or least-recent strategies
- **Multi-Token CLI** — Pass multiple tokens directly on the command line, account type and username auto-detected
- **Usage Tracking & Dashboard** — Built-in SQLite database tracks per-model token usage and costs; web dashboard at `/usage`
- **Automatic Pricing Sync** — Periodically fetches model pricing from Azure and Anthropic to calculate accurate cost estimates
- **Rate Limiting** — Configurable request throttling with optional wait mode
- **Manual Request Approval** — Approve or deny each API request interactively
- **Cross-Runtime** — Runs on both Node.js (via npx) and Bun, with runtime-adaptive SQLite (better-sqlite3 / bun:sqlite)

## Demo

https://github.com/user-attachments/assets/7654b383-669d-4eb9-b23c-06d7aefee8c5

## Quick Start

### Using npx (Node.js)

```sh
# Start the server (will prompt for GitHub auth on first run)
npx @weavejam/copilot-proxy@latest start

# Start with a specific token
npx @weavejam/copilot-proxy@latest start --github-token ghu_YOUR_TOKEN
```

### Using Bun

```sh
bun install
bun run start
```

### Prerequisites

- **Node.js >= 18** or **Bun >= 1.2**
- GitHub account with an active Copilot subscription (individual, business, or enterprise)

## Authentication

### Interactive (Device Flow OAuth)

When no token is provided, the proxy starts an interactive GitHub Device Flow. Follow the on-screen instructions to authorize.

### Direct Token

Pass a token from a previous `auth` session:

```sh
npx @weavejam/copilot-proxy@latest start --github-token ghu_YOUR_TOKEN
```

### Multi-Token CLI

Pass multiple tokens using `--github-token`. Account type and username are **auto-detected** from each token via the GitHub API. Both repeated flags and comma-separated values are supported:

```sh
# Multiple tokens — username and account type auto-detected
npx @weavejam/copilot-proxy@latest start \
  --github-token ghu_aaa \
  --github-token ghu_bbb

# With custom account names: name:token
npx @weavejam/copilot-proxy@latest start \
  --github-token personal:ghu_aaa \
  --github-token work:ghu_bbb

# Comma-separated in a single flag
npx @weavejam/copilot-proxy@latest start \
  --github-token "ghu_aaa,work:ghu_bbb"
```

Format: `token` or `name:token`. If no name is given, the GitHub username is used automatically. Account type (individual/business/enterprise) is always auto-detected — no need to specify it.

### Accounts File

For persistent multi-account configuration, create a JSON file:

```json
{
  "accounts": [
    { "name": "personal", "github_token": "ghu_...", "account_type": "individual" },
    { "name": "work", "github_token": "ghu_...", "account_type": "business" }
  ]
}
```

```sh
npx @weavejam/copilot-proxy@latest start --accounts-file ./accounts.json
```

### Account Management Commands

```sh
# Add account interactively (auto-detects GitHub username and account type)
npx @weavejam/copilot-proxy@latest auth add

# Add with explicit name
npx @weavejam/copilot-proxy@latest auth add --name work

# List all configured accounts
npx @weavejam/copilot-proxy@latest auth list

# Remove an account
npx @weavejam/copilot-proxy@latest auth remove --name work

# Legacy single-token auth (backward compatible)
npx @weavejam/copilot-proxy@latest auth
```

Accounts are stored in `~/.local/share/copilot-api/accounts.json`.

## Multi-Account Load Balancing

When using multiple accounts, choose a strategy with `--strategy`:

| Strategy | Description |
| --- | --- |
| `round-robin` (default) | Rotate through accounts in order |
| `least-busy` | Pick the account with fewest in-flight requests |
| `least-recent` | Pick the account used least recently |

```sh
npx @weavejam/copilot-proxy@latest start \
  --accounts-file ./accounts.json --strategy least-busy
```

## Using with Claude Code

### Interactive Setup

```sh
npx @weavejam/copilot-proxy@latest start --claude-code
```

Select a primary and a small/fast model when prompted. A command is copied to your clipboard — paste it into a new terminal to launch Claude Code.

### Manual Configuration

Create `.claude/settings.json` in your project root:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4141",
    "ANTHROPIC_AUTH_TOKEN": "dummy",
    "ANTHROPIC_MODEL": "gpt-4.1",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-4.1",
    "ANTHROPIC_SMALL_FAST_MODEL": "gpt-4.1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-4.1",
    "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "permissions": {
    "deny": ["WebSearch"]
  }
}
```

See: [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings#environment-variables) | [IDE integrations](https://docs.anthropic.com/en/docs/claude-code/ide-integrations)

## Pricing Sync

The proxy fetches model pricing from Azure and Anthropic pricing pages, storing per-model cost data in the local SQLite database. This powers the cost estimates in the `/usage` endpoint.

- **Automatic**: Syncs every 7 days on server start. Configure with `--pricing-sync-interval-days` or disable with `--pricing-sync-disabled`.
- **Manual**: Run a one-off sync:

```sh
npx @weavejam/copilot-proxy@latest pricing-sync
```

## Usage Dashboard

After starting the server, a URL to the web-based usage dashboard is printed to the console:

```
https://ericc-ch.github.io/copilot-api?endpoint=http://localhost:4141/usage
```

The dashboard shows per-model token usage, cost breakdowns, and quota information.

You can also check usage directly in the terminal (no server required):

```sh
npx @weavejam/copilot-proxy@latest check-usage
```

## API Endpoints

### OpenAI Compatible

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/chat/completions` | POST | Chat completions (streaming supported) |
| `/v1/models` | GET | List available models |
| `/v1/embeddings` | POST | Generate embedding vectors |

### Anthropic Compatible

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/messages` | POST | Messages API (streaming supported) |
| `/v1/messages/count_tokens` | POST | Count tokens for a message set |

### Monitoring

| Endpoint | Method | Description |
| --- | --- | --- |
| `/usage` | GET | Detailed usage statistics with cost estimates |
| `/token` | GET | Current Copilot token |
| `/` | GET | Health check |

## Command Reference

### Commands

| Command | Description |
| --- | --- |
| `start` | Start the proxy server |
| `auth` | Legacy single-token authentication |
| `auth add` | Add a GitHub account via Device Flow OAuth |
| `auth list` | List configured accounts |
| `auth remove` | Remove an account |
| `check-usage` | Show Copilot usage/quota in terminal |
| `pricing-sync` | Run one-off pricing data sync |
| `debug` | Show diagnostic information |

### `start` Options

| Option | Description | Default | Alias |
| --- | --- | --- | --- |
| `--port` | Port to listen on | 4141 | `-p` |
| `--verbose` | Enable verbose logging | false | `-v` |
| `--account-type` | Account type (individual, business, enterprise) | individual | `-a` |
| `--github-token` | GitHub token(s), supports repeated flags or comma-separated `name:token` (type auto-detected) | — | `-g` |
| `--accounts-file` | Path to accounts JSON file | — | — |
| `--strategy` | Load balancing: round-robin, least-busy, least-recent | round-robin | — |
| `--rate-limit` | Minimum seconds between requests | — | `-r` |
| `--wait` | Wait instead of error on rate limit | false | `-w` |
| `--manual` | Enable manual request approval | false | — |
| `--claude-code` | Interactive Claude Code setup | false | `-c` |
| `--show-token` | Show tokens on fetch and refresh | false | — |
| `--proxy-env` | Use HTTP_PROXY/HTTPS_PROXY env vars | false | — |
| `--db-path` | Path to SQLite database | auto | — |
| `--pricing-sync-model` | Model for LLM pricing extraction | auto | — |
| `--pricing-sync-interval-days` | Days between automatic pricing syncs | 7 | — |
| `--pricing-sync-disabled` | Disable automatic pricing sync | false | — |

### `auth add` Options

| Option | Description | Default | Alias |
| --- | --- | --- | --- |
| `--name` | Account name (defaults to GitHub username) | auto | `-n` |
| `--verbose` | Verbose logging | false | `-v` |

### `auth remove` Options

| Option | Description | Default | Alias |
| --- | --- | --- | --- |
| `--name` | Account name to remove | required | `-n` |
| `--verbose` | Verbose logging | false | `-v` |

### `pricing-sync` Options

| Option | Description | Default | Alias |
| --- | --- | --- | --- |
| `--port` | Temp server port for LLM call | 4141 | `-p` |
| `--sync-model` | Model for extraction | auto | — |
| `--github-token` | GitHub token(s), same format as start | — | `-g` |
| `--accounts-file` | Accounts JSON file | — | — |
| `--account-type` | Account type | individual | `-a` |
| `--db-path` | SQLite database path | auto | — |
| `--proxy-env` | Use proxy env vars | false | — |
| `--verbose` | Verbose logging | false | `-v` |

### `debug` Options

| Option | Description | Default |
| --- | --- | --- |
| `--json` | Output as JSON | false |

## Docker

### Build & Run

```sh
docker build -t copilot-api .
mkdir -p ./copilot-data
docker run -p 4141:4141 -v $(pwd)/copilot-data:/root/.local/share/copilot-api copilot-api
```

### With Token

```sh
docker run -p 4141:4141 -e GH_TOKEN=ghu_YOUR_TOKEN copilot-api
```

### Docker Compose

```yaml
version: "3.8"
services:
  copilot-api:
    build: .
    ports:
      - "4141:4141"
    environment:
      - GH_TOKEN=ghu_YOUR_TOKEN
    restart: unless-stopped
```

## Development

```sh
# Install dependencies
bun install

# Development mode (watch)
bun run dev

# Production mode
bun run start

# Run tests
bun test

# Build for npm
bun run build

# Type check
bun run typecheck

# Lint
bun run lint
```

## Data Storage

All data is stored in `~/.local/share/copilot-api/`:

| File | Purpose |
| --- | --- |
| `github_token` | Stored GitHub OAuth token |
| `accounts.json` | Multi-account configuration |
| `usage.sqlite` | Usage tracking and pricing data |

## Usage Tips

- Use `--rate-limit 30 --wait` to throttle requests and queue them instead of erroring.
- Use `--manual` to approve each request individually — useful for debugging or auditing.
- Use `--account-type business` or `enterprise` if your Copilot subscription is through an organization. See the [official docs](https://docs.github.com/en/enterprise-cloud@latest/copilot/managing-copilot/managing-github-copilot-in-your-organization/managing-access-to-github-copilot-in-your-organization/managing-github-copilot-access-to-your-organizations-network#configuring-copilot-subscription-based-network-routing-for-your-enterprise-or-organization).
- Multi-token CLI supports both repeated flags (`--github-token ghu_x --github-token ghu_y`) and comma-separated (`--github-token "ghu_x,ghu_y"`). Account type and username are auto-detected.
