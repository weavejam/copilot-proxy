import consola from "consola"

import { GITHUB_API_BASE_URL, standardHeaders } from "~/lib/api-config"

export interface AccountInfo {
  login: string
  accountType: string
}

/**
 * Detect GitHub username and Copilot account type from a raw GitHub token.
 * Calls `/user` and `/copilot_internal/user` in parallel.
 */
export async function detectAccountInfo(
  githubToken: string,
): Promise<AccountInfo> {
  const headers = {
    authorization: `token ${githubToken}`,
    ...standardHeaders(),
  }

  const [userResult, copilotResult] = await Promise.allSettled([
    fetch(`${GITHUB_API_BASE_URL}/user`, { headers }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as { login: string }
    }),
    fetch(`${GITHUB_API_BASE_URL}/copilot_internal/user`, { headers }).then(
      async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as { copilot_plan: string }
      },
    ),
  ])

  const login =
    userResult.status === "fulfilled" ? userResult.value.login : "unknown"
  if (userResult.status === "rejected") {
    consola.warn("Could not detect GitHub username, using 'unknown'")
  }

  let accountType = "individual"
  if (copilotResult.status === "fulfilled") {
    const plan = copilotResult.value.copilot_plan
    if (plan === "business" || plan === "enterprise") {
      accountType = plan
    }
  } else {
    consola.warn(
      `[${login}] Could not detect Copilot plan, defaulting to individual`,
    )
  }

  return { login, accountType }
}
