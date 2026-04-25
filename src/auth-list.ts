import { defineCommand } from "citty"
import consola from "consola"

import { readAccountsFile } from "./lib/accounts-loader"
import { ensurePaths } from "./lib/paths"
import { state } from "./lib/state"
import { getGitHubUser } from "./services/github/get-user"

interface RunAuthListOptions {
  verbose: boolean
}

export async function runAuthList(options: RunAuthListOptions): Promise<void> {
  if (options.verbose) {
    consola.level = 5
  }
  await ensurePaths()

  const data = await readAccountsFile()
  if (data.accounts.length === 0) {
    consola.info("No accounts found. Use `auth add` to add one.")
    return
  }

  const rows: Array<{ name: string; type: string; login: string }> = []
  for (const entry of data.accounts) {
    let login: string
    try {
      const user = await getGitHubUser({
        account: {
          name: entry.name,
          accountType: entry.account_type ?? "individual",
          githubToken: entry.github_token,
          copilotTokenRefreshAt: 0,
          inFlight: 0,
          lastUsedAt: 0,
          failureCount: 0,
        },
        vsCodeVersion: state.vsCodeVersion,
      })
      login = user.login
    } catch {
      login = "(token invalid)"
    }
    rows.push({
      name: entry.name,
      type: entry.account_type ?? "individual",
      login,
    })
  }

  console.table(rows)
}

export const authList = defineCommand({
  meta: {
    name: "list",
    description: "List all configured GitHub accounts",
  },
  args: {
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
  },
  run({ args }) {
    return runAuthList({ verbose: args.verbose })
  },
})
