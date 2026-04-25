import type { ApiContext } from "~/lib/api-config"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"

export const createEmbeddings = async (
  ctx: ApiContext,
  payload: EmbeddingRequest,
) => {
  if (!ctx.account.copilotToken) throw new Error("Copilot token not found")

  const response = await fetch(`${copilotBaseUrl(ctx)}/embeddings`, {
    method: "POST",
    headers: copilotHeaders(ctx),
    body: JSON.stringify(payload),
  })

  if (!response.ok) throw new HTTPError("Failed to create embeddings", response)

  return (await response.json()) as EmbeddingResponse
}

export interface EmbeddingRequest {
  input: string | Array<string>
  model: string
}

export interface Embedding {
  object: string
  embedding: Array<number>
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: Array<Embedding>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}
