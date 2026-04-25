import type { ApiContext } from "~/lib/api-config"

import { GITHUB_API_BASE_URL, standardHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"

export async function getGitHubUser(ctx: ApiContext) {
  const response = await fetch(`${GITHUB_API_BASE_URL}/user`, {
    headers: {
      authorization: `token ${ctx.account.githubToken}`,
      ...standardHeaders(),
    },
  })

  if (!response.ok) throw new HTTPError("Failed to get GitHub user", response)

  return (await response.json()) as GithubUserResponse
}

interface GithubUserResponse {
  login: string
}
