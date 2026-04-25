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

const readGithubToken = () => fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")

const writeGithubToken = (token: string) =>
  fs.writeFile(PATHS.GITHUB_TOKEN_PATH, token)

/**
 * Set up the Copilot token for a single account, including auto-refresh.
 * The previous global helper `setupCopilotToken` is replaced by per-account
 * setup; legacy `state.copilotToken` is mirrored for not-yet-migrated callers.
 */
export const setupCopilotTokenFor = async (account: Account) => {
  // Temporarily expose this account's GitHub token for the legacy
  // api-config helper which still reads `state.githubToken`.
  state.githubToken = account.githubToken
  const { token, refresh_in } = await getCopilotToken()
  /* eslint-disable require-atomic-updates */
  account.copilotToken = token
  account.copilotTokenRefreshAt = Date.now() + refresh_in * 1000
  /* eslint-enable require-atomic-updates */

  // Mirror the first account's token into legacy state for callers
  // not yet migrated to the pool (removed in task 03).
  state.copilotToken = token

  consola.debug(`[${account.name}] Copilot token fetched successfully`)
  if (state.showToken) {
    consola.info(`[${account.name}] Copilot token:`, token)
  }

  const refreshInterval = (refresh_in - 60) * 1000
  account.refreshTimer = setInterval(async () => {
    consola.debug(`[${account.name}] Refreshing Copilot token`)
    try {
      state.githubToken = account.githubToken
      const refreshed = await getCopilotToken()
      /* eslint-disable require-atomic-updates */
      account.copilotToken = refreshed.token
      account.copilotTokenRefreshAt = Date.now() + refreshed.refresh_in * 1000
      /* eslint-enable require-atomic-updates */
      state.copilotToken = refreshed.token
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

export async function setupGitHubToken(
  options?: SetupGitHubTokenOptions,
): Promise<void> {
  try {
    const githubToken = await readGithubToken()

    if (githubToken && !options?.force) {
      state.githubToken = githubToken
      if (state.showToken) {
        consola.info("GitHub token:", githubToken)
      }
      await logUser()

      return
    }

    consola.info("Not logged in, getting new access token")
    const response = await getDeviceCode()
    consola.debug("Device code response:", response)

    consola.info(
      `Please enter the code "${response.user_code}" in ${response.verification_uri}`,
    )

    const token = await pollAccessToken(response)
    await writeGithubToken(token)
    state.githubToken = token

    if (state.showToken) {
      consola.info("GitHub token:", token)
    }
    await logUser()
  } catch (error) {
    if (error instanceof HTTPError) {
      consola.error("Failed to get GitHub token:", await error.response.json())
      throw error
    }

    consola.error("Failed to get GitHub token:", error)
    throw error
  }
}

/** Backwards-compat wrapper: sets up Copilot token for the default account. */
export const setupCopilotToken = async () => {
  if (state.pool && state.pool.accounts.length > 0) {
    await setupCopilotTokenFor(state.pool.accounts[0])
    return
  }
  // No pool yet (very early callers) — do nothing.
}

async function logUser() {
  const user = await getGitHubUser()
  consola.info(`Logged in as ${user.login}`)
}
