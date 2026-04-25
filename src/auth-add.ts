import { defineCommand } from "citty"
import consola from "consola"

import { addAccountEntry } from "./lib/accounts-loader"
import { ensurePaths } from "./lib/paths"
import { state } from "./lib/state"
import { runDeviceFlow } from "./lib/token"
import { getGitHubUser } from "./services/github/get-user"

interface RunAuthAddOptions {
  name?: string
  accountType: string
  verbose: boolean
}

async function resolveAccountName(
  token: string,
  explicitName?: string,
): Promise<string> {
  if (explicitName) return explicitName
  try {
    const user = await getGitHubUser({
      account: {
        name: "_probe",
        accountType: state.accountType,
        githubToken: token,
        copilotTokenRefreshAt: 0,
        inFlight: 0,
        lastUsedAt: 0,
        failureCount: 0,
      },
      vsCodeVersion: state.vsCodeVersion,
    })
    consola.info(`Detected GitHub user: ${user.login}`)
    return user.login
  } catch {
    consola.warn("Could not detect GitHub username, using 'default'")
    return "default"
  }
}

export async function runAuthAdd(options: RunAuthAddOptions): Promise<void> {
  if (options.verbose) {
    consola.level = 5
  }
  state.accountType = options.accountType
  await ensurePaths()

  consola.info("Starting GitHub Device Flow authentication…")
  const token = await runDeviceFlow()

  const name = await resolveAccountName(token, options.name)
  await addAccountEntry({
    name,
    github_token: token,
    account_type: options.accountType,
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
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type (individual, business, enterprise)",
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
      accountType: args["account-type"],
      verbose: args.verbose,
    })
  },
})
