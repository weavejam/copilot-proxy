import { defineCommand } from "citty"
import consola from "consola"

import { removeAccountEntry } from "./lib/accounts-loader"
import { ensurePaths } from "./lib/paths"

interface RunAuthRemoveOptions {
  name: string
  verbose: boolean
}

export async function runAuthRemove(
  options: RunAuthRemoveOptions,
): Promise<void> {
  if (options.verbose) {
    consola.level = 5
  }
  await ensurePaths()

  const removed = await removeAccountEntry(options.name)
  if (!removed) {
    consola.warn(`Account "${options.name}" not found`)
    process.exitCode = 1
  }
}

export const authRemove = defineCommand({
  meta: {
    name: "remove",
    description: "Remove a GitHub account by name",
  },
  args: {
    name: {
      alias: "n",
      type: "string",
      required: true,
      description: "Name of the account to remove",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
  },
  run({ args }) {
    return runAuthRemove({
      name: args.name,
      verbose: args.verbose,
    })
  },
})
