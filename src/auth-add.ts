import { defineCommand } from "citty"
import consola from "consola"

import { addAccountEntry } from "./lib/accounts-loader"
import { ensurePaths } from "./lib/paths"
import { state } from "./lib/state"
import { runDeviceFlow } from "./lib/token"
import { detectAccountInfo } from "./services/github/detect-account-info"

interface RunAuthAddOptions {
  name?: string
  verbose: boolean
}

export async function runAuthAdd(options: RunAuthAddOptions): Promise<void> {
  if (options.verbose) {
    consola.level = 5
  }
  await ensurePaths()

  consola.info("Starting GitHub Device Flow authentication…")
  const token = await runDeviceFlow()

  const info = await detectAccountInfo(token)
  const name = options.name ?? info.login
  state.accountType = info.accountType

  consola.info(`Detected GitHub user: ${info.login} (${info.accountType})`)

  await addAccountEntry({
    name,
    github_token: token,
    account_type: info.accountType,
  })
}

export const authAdd = defineCommand({
  meta: {
    name: "add",
    description: "Add a new GitHub account via Device Flow OAuth",
  },
  args: {
    name: {
      alias: "n",
      type: "string",
      description: "Account name (defaults to GitHub username if not provided)",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
  },
  run({ args }) {
    return runAuthAdd({
      name: args.name,
      verbose: args.verbose,
    })
  },
})
