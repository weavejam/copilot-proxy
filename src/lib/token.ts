import consola from "consola"
import fs from "node:fs/promises"

import type { Account } from "~/lib/account-pool"

import { PATHS } from "~/lib/paths"
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessToken } from "~/services/github/poll-access-token"

import { HTTPError } from "./error"
import { state } from "./state"
import { makeApiContext } from "./utils"

const readGithubToken = () => fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")

const writeGithubToken = (token: string) =>
  fs.writeFile(PATHS.GITHUB_TOKEN_PATH, token)

/** Per-account Copilot token setup with auto-refresh. */
export const setupCopilotTokenFor = async (account: Account) => {
  const ctx = makeApiContext(account)
  const { token, refresh_in } = await getCopilotToken(ctx)
  /* eslint-disable require-atomic-updates */
  account.copilotToken = token
  account.copilotTokenRefreshAt = Date.now() + refresh_in * 1000
  /* eslint-enable require-atomic-updates */

  consola.debug(`[${account.name}] Copilot token fetched successfully`)
  if (state.showToken) {
    consola.info(`[${account.name}] Copilot token:`, token)
  }

  const refreshInterval = (refresh_in - 60) * 1000
  account.refreshTimer = setInterval(async () => {
    consola.debug(`[${account.name}] Refreshing Copilot token`)
    try {
      const refreshed = await getCopilotToken(makeApiContext(account))
      /* eslint-disable require-atomic-updates */
      account.copilotToken = refreshed.token
      account.copilotTokenRefreshAt = Date.now() + refreshed.refresh_in * 1000
      /* eslint-enable require-atomic-updates */
      consola.debug(`[${account.name}] Copilot token refreshed`)
      if (state.showToken) {
        consola.info(
          `[${account.name}] Refreshed Copilot token:`,
          refreshed.token,
        )
      }
    } catch (error) {
      consola.error(`[${account.name}] Failed to refresh Copilot token:`, error)
      throw error
    }
  }, refreshInterval)
}

interface SetupGitHubTokenOptions {
  force?: boolean
}

/**
 * Reads or fetches a single GitHub token file at PATHS.GITHUB_TOKEN_PATH.
 * Returns the token; the caller is responsible for putting it into the
 * account pool.
 */
export async function setupGitHubToken(
  options?: SetupGitHubTokenOptions,
): Promise<string> {
  try {
    const githubToken = await readGithubToken()

    if (githubToken && !options?.force) {
      if (state.showToken) {
        consola.info("GitHub token:", githubToken)
      }
      await logUser(githubToken)
      return githubToken
    }

    consola.info("Not logged in, getting new access token")
    const response = await getDeviceCode()
    consola.debug("Device code response:", response)

    consola.info(
      `Please enter the code "${response.user_code}" in ${response.verification_uri}`,
    )

    const token = await pollAccessToken(response)
    await writeGithubToken(token)

    if (state.showToken) {
      consola.info("GitHub token:", token)
    }
    await logUser(token)
    return token
  } catch (error) {
    if (error instanceof HTTPError) {
      consola.error("Failed to get GitHub token:", await error.response.json())
      throw error
    }

    consola.error("Failed to get GitHub token:", error)
    throw error
  }
}

async function logUser(githubToken: string) {
  // Build a temporary "anonymous" account with just the GitHub token,
  // so we can call /user without going through the pool.
  const tempAccount: Account = {
    name: "_setup",
    accountType: state.accountType,
    githubToken,
    copilotTokenRefreshAt: 0,
    inFlight: 0,
    lastUsedAt: 0,
    failureCount: 0,
  }
  const user = await getGitHubUser({
    account: tempAccount,
    vsCodeVersion: state.vsCodeVersion,
  })
  consola.info(`Logged in as ${user.login}`)
}
