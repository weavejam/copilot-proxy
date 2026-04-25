#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"

import { authAdd } from "./auth-add"
import { authList } from "./auth-list"
import { authRemove } from "./auth-remove"
import { PATHS, ensurePaths } from "./lib/paths"
import { state } from "./lib/state"
import { setupGitHubToken } from "./lib/token"

interface RunAuthOptions {
  verbose: boolean
  showToken: boolean
}

export async function runAuth(options: RunAuthOptions): Promise<void> {
  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.showToken = options.showToken

  await ensurePaths()
  await setupGitHubToken({ force: true })
  consola.success("GitHub token written to", PATHS.GITHUB_TOKEN_PATH)
}

export const auth = defineCommand({
  meta: {
    name: "auth",
    description:
      "Manage GitHub authentication. Run without subcommand for legacy single-token flow.",
  },
  args: {
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub token on auth",
    },
  },
  subCommands: {
    add: authAdd,
    list: authList,
    remove: authRemove,
  },
  run({ args }) {
    return runAuth({
      verbose: args.verbose,
      showToken: args["show-token"],
    })
  },
})
