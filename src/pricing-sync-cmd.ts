import { defineCommand } from "citty"
import consola from "consola"
import { serve, type ServerHandler } from "srvx"

import { loadAccounts } from "./lib/accounts-loader"
import { initDb } from "./lib/db"
import { ensurePaths, PATHS } from "./lib/paths"
import { runPricingSync } from "./lib/pricing-sync-runner"
import { initProxyFromEnv } from "./lib/proxy"
import { state } from "./lib/state"
import { setupCopilotTokenFor, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"
import { server } from "./server"

interface RunPricingSyncCmdOptions {
  port: number
  syncModel?: string
  githubToken?: string
  accountsFile?: string
  accountType: string
  dbPath: string
  proxyEnv: boolean
  verbose: boolean
}

async function bootstrapServer(
  options: RunPricingSyncCmdOptions,
): Promise<void> {
  if (options.proxyEnv) {
    initProxyFromEnv()
  }
  if (options.verbose) {
    consola.level = 5
  }

  state.accountType = options.accountType
  await ensurePaths()
  initDb(options.dbPath)
  await cacheVSCodeVersion()

  let legacyToken = options.githubToken
  if (!options.accountsFile && !legacyToken) {
    legacyToken = await setupGitHubToken()
  }

  const loaded = await loadAccounts({
    accountsFile: options.accountsFile,
    legacyToken,
    defaultAccountType: options.accountType,
  })

  if (loaded.length === 0) {
    throw new Error("No accounts available.")
  }

  state.pool = undefined as never // not needed for sync
  await Promise.all(loaded.map((a) => setupCopilotTokenFor(a)))
  await cacheModels()
}

function startTempServer(port: number): void {
  serve({
    fetch: server.fetch as ServerHandler,
    port,
  })
}

export async function runPricingSyncCmd(
  options: RunPricingSyncCmdOptions,
): Promise<void> {
  await bootstrapServer(options)
  startTempServer(options.port)

  consola.info("Running one-off pricing sync…")
  const result = await runPricingSync({
    port: options.port,
    syncModel: options.syncModel,
  })

  if (result.status === "ok") {
    consola.success(`Pricing sync complete: ${result.updated} model(s) updated`)
  } else if (result.status === "rejected") {
    consola.warn(
      `Pricing sync rejected (sanity check): ${result.rejected} model(s)`,
    )
  } else {
    consola.error(`Pricing sync failed: ${result.error ?? "unknown error"}`)
  }

  process.exit(result.status === "ok" ? 0 : 1)
}

export const pricingSyncCmd = defineCommand({
  meta: {
    name: "pricing-sync",
    description: "Run a one-off pricing sync against Azure and Anthropic",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port for the temporary server (needed for LLM self-call)",
    },
    "sync-model": {
      type: "string",
      description: "Model to use for the LLM extraction step",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description: "GitHub token",
    },
    "accounts-file": {
      type: "string",
      description: "Path to accounts JSON file",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type",
    },
    "db-path": {
      type: "string",
      default: PATHS.USAGE_DB_PATH,
      description: "Path to the usage SQLite database",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
  },
  run({ args }) {
    return runPricingSyncCmd({
      port: Number.parseInt(args.port, 10),
      syncModel: args["sync-model"],
      githubToken: args["github-token"],
      accountsFile: args["accounts-file"],
      accountType: args["account-type"],
      dbPath: args["db-path"],
      proxyEnv: args["proxy-env"],
      verbose: args.verbose,
    })
  },
})
