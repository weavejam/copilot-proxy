#!/usr/bin/env node

import { defineCommand } from "citty"
import clipboard from "clipboardy"
import consola from "consola"
import { serve, type ServerHandler } from "srvx"
import invariant from "tiny-invariant"

import { AccountPool, type Strategy } from "./lib/account-pool"
import {
  loadAccounts,
  parseGithubTokenArgs,
  persistAccounts,
} from "./lib/accounts-loader"
import { initDb } from "./lib/db"
import { ensurePaths, PATHS } from "./lib/paths"
import { schedulePricingSync } from "./lib/pricing-scheduler"
import { initProxyFromEnv } from "./lib/proxy"
import { generateEnvScript } from "./lib/shell"
import { state } from "./lib/state"
import { setupCopilotTokenFor, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"
import { server } from "./server"

interface RunServerOptions {
  port: number
  verbose: boolean
  accountType: string
  manual: boolean
  rateLimit?: number
  rateLimitWait: boolean
  githubToken?: string
  claudeCode: boolean
  showToken: boolean
  proxyEnv: boolean
  dbPath: string
  accountsFile?: string
  strategy: Strategy
  pricingSyncModel?: string
  pricingSyncIntervalDays: number
  pricingSyncDisabled: boolean
}

/** Citty may return a string or string[] for repeated --github-token flags. Normalize to comma-separated. */
function normalizeGithubToken(
  raw: string | Array<string> | undefined,
): string | undefined {
  if (!raw) return undefined
  return Array.isArray(raw) ? raw.join(",") : raw
}

async function promptClaudeCodeSetup(serverUrl: string): Promise<void> {
  invariant(state.models, "Models should be loaded by now")

  const selectedModel = await consola.prompt(
    "Select a model to use with Claude Code",
    {
      type: "select",
      options: state.models.data.map((model) => model.id),
    },
  )

  const selectedSmallModel = await consola.prompt(
    "Select a small model to use with Claude Code",
    {
      type: "select",
      options: state.models.data.map((model) => model.id),
    },
  )

  const command = generateEnvScript(
    {
      ANTHROPIC_BASE_URL: serverUrl,
      ANTHROPIC_AUTH_TOKEN: "dummy",
      ANTHROPIC_MODEL: selectedModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: selectedModel,
      ANTHROPIC_SMALL_FAST_MODEL: selectedSmallModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: selectedSmallModel,
      DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
    "claude",
  )

  try {
    clipboard.writeSync(command)
    consola.success("Copied Claude Code command to clipboard!")
  } catch {
    consola.warn(
      "Failed to copy to clipboard. Here is the Claude Code command:",
    )
    consola.log(command)
  }
}

export async function runServer(options: RunServerOptions): Promise<void> {
  if (options.proxyEnv) {
    initProxyFromEnv()
  }

  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.accountType = options.accountType
  state.strategy = options.strategy
  if (options.accountType !== "individual") {
    consola.info(`Using ${options.accountType} plan GitHub account`)
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait
  state.showToken = options.showToken

  await ensurePaths()
  initDb(options.dbPath)
  await cacheVSCodeVersion()

  // Resolve accounts: multi-token CLI → accounts file → single token → interactive
  let legacyToken: string | undefined
  let multiTokenEntries: ReturnType<typeof parseGithubTokenArgs> | undefined

  if (options.githubToken && !options.accountsFile) {
    multiTokenEntries = parseGithubTokenArgs(
      options.githubToken,
      options.accountType,
    )
    if (multiTokenEntries.length > 0) {
      consola.info("Using provided GitHub token(s)")
    }
  }

  if (!multiTokenEntries?.length && !options.accountsFile) {
    legacyToken = await setupGitHubToken()
  }

  const loaded = await loadAccounts({
    accountsFile: options.accountsFile,
    legacyTokens: multiTokenEntries,
    legacyToken,
    defaultAccountType: options.accountType,
  })

  if (loaded.length === 0) {
    throw new Error(
      "No accounts available. Provide --accounts-file or --github-token, or run `auth`.",
    )
  }

  const pool = new AccountPool(loaded, options.strategy)

  state.pool = pool
  persistAccounts(loaded)

  consola.info(
    `Loaded ${loaded.length} account${loaded.length === 1 ? "" : "s"} (strategy: ${options.strategy})`,
  )

  // Fetch Copilot token for each account in parallel.
  await Promise.all(loaded.map((a) => setupCopilotTokenFor(a)))
  for (const a of loaded) {
    consola.info(`[${a.name}] ready`)
  }

  await cacheModels()

  consola.info(
    `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
  )

  const serverUrl = `http://localhost:${options.port}`

  if (options.claudeCode) {
    await promptClaudeCodeSetup(serverUrl)
  }

  consola.box(
    `🌐 Usage Viewer: https://ericc-ch.github.io/copilot-api?endpoint=${serverUrl}/usage`,
  )

  serve({
    fetch: server.fetch as ServerHandler,
    port: options.port,
  })

  if (!options.pricingSyncDisabled) {
    schedulePricingSync({
      port: options.port,
      intervalDays: options.pricingSyncIntervalDays,
      syncModel: options.pricingSyncModel,
    })
  }
}

export const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Copilot API server",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port to listen on",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type to use (individual, business, enterprise)",
    },
    manual: {
      type: "boolean",
      default: false,
      description: "Enable manual request approval",
    },
    "rate-limit": {
      alias: "r",
      type: "string",
      description: "Rate limit in seconds between requests",
    },
    wait: {
      alias: "w",
      type: "boolean",
      default: false,
      description:
        "Wait instead of error when rate limit is hit. Has no effect if rate limit is not set",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token(s) directly. Supports comma-separated multi-token format: "
        + 'name:type:token (e.g. "personal:individual:ghu_aaa,work:business:ghu_bbb")',
    },
    "claude-code": {
      alias: "c",
      type: "boolean",
      default: false,
      description:
        "Generate a command to launch Claude Code with Copilot API config",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub and Copilot tokens on fetch and refresh",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
    "db-path": {
      type: "string",
      default: PATHS.USAGE_DB_PATH,
      description:
        "Path to the usage SQLite database (defaults to ~/.local/share/copilot-api/usage.sqlite)",
    },
    "accounts-file": {
      type: "string",
      description:
        "Path to a JSON file containing multiple GitHub Copilot accounts",
    },
    strategy: {
      type: "string",
      default: "round-robin",
      description:
        "Account selection strategy: round-robin | least-busy | least-recent",
    },
    "pricing-sync-model": {
      type: "string",
      description:
        "Model to use for LLM-powered pricing sync (default: auto-select from whitelist)",
    },
    "pricing-sync-interval-days": {
      type: "string",
      default: "7",
      description: "How often (in days) to re-sync model pricing",
    },
    "pricing-sync-disabled": {
      type: "boolean",
      default: false,
      description: "Disable automatic background pricing sync",
    },
  },
  run({ args }) {
    const rateLimitRaw = args["rate-limit"]
    const rateLimit =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      rateLimitRaw === undefined ? undefined : Number.parseInt(rateLimitRaw, 10)

    return runServer({
      port: Number.parseInt(args.port, 10),
      verbose: args.verbose,
      accountType: args["account-type"],
      manual: args.manual,
      rateLimit,
      rateLimitWait: args.wait,
      githubToken: normalizeGithubToken(args["github-token"]),
      claudeCode: args["claude-code"],
      showToken: args["show-token"],
      proxyEnv: args["proxy-env"],
      dbPath: args["db-path"],
      accountsFile: args["accounts-file"],
      strategy: args.strategy as Strategy,
      pricingSyncModel: args["pricing-sync-model"],
      pricingSyncIntervalDays: Number.parseInt(
        args["pricing-sync-interval-days"],
        10,
      ),
      pricingSyncDisabled: args["pricing-sync-disabled"],
    })
  },
})
