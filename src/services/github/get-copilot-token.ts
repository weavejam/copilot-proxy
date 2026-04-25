import type { ApiContext } from "~/lib/api-config"

import { GITHUB_API_BASE_URL, githubHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"

export const getCopilotToken = async (ctx: ApiContext) => {
  const response = await fetch(
    `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
    {
      headers: githubHeaders(ctx),
    },
  )

  if (!response.ok) throw new HTTPError("Failed to get Copilot token", response)

  return (await response.json()) as GetCopilotTokenResponse
}

interface GetCopilotTokenResponse {
  expires_at: number
  refresh_in: number
  token: string
}
