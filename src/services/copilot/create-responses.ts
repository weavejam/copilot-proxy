import consola from "consola"
import { events } from "fetch-event-stream"

import type { ApiContext } from "~/lib/api-config"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"

import {
  type ChatCompletionChunk,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "./create-chat-completions"
import {
  makeResponsesStreamState,
  translateChatToResponses,
  translateResponsesEventToChatChunks,
  translateResponsesToChat,
  type ResponsesFinalResponse,
} from "./responses-translation"

/**
 * Call Copilot's `/responses` endpoint while accepting and emitting the
 * OpenAI chat.completions wire format used everywhere else in this proxy.
 *
 * The shape of the return value mirrors `createChatCompletions` exactly:
 *   - non-streaming → `ChatCompletionResponse`
 *   - streaming     → `AsyncIterable<{ data?: string }>` whose `data` payloads
 *                     are stringified `ChatCompletionChunk` objects.
 *
 * This means upstream handlers (chat-completions, messages) and the usage
 * accumulator do not need to learn about the Responses protocol.
 */
export const createResponses = async (
  ctx: ApiContext,
  payload: ChatCompletionsPayload,
): Promise<ChatCompletionResponse | AsyncIterable<{ data?: string }>> => {
  if (!ctx.account.copilotToken) throw new Error("Copilot token not found")

  const responsesPayload = translateChatToResponses(payload)

  const enableVision = payload.messages.some(
    (m) =>
      Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
  )

  const isAgentCall = payload.messages.some((m) =>
    ["assistant", "tool"].includes(m.role),
  )

  const headers: Record<string, string> = {
    ...copilotHeaders(ctx, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const response = await fetch(`${copilotBaseUrl(ctx)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(responsesPayload),
  })

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  if (payload.stream) {
    const upstream = events(response)
    return translateStreamToChatChunks(upstream)
  }

  const raw = (await response.json()) as ResponsesFinalResponse
  return translateResponsesToChat(raw)
}

async function* translateStreamToChatChunks(
  upstream: AsyncIterable<{ data?: string; event?: string }>,
): AsyncIterable<{ data?: string }> {
  const state = makeResponsesStreamState()
  for await (const ev of upstream) {
    if (!ev.data) continue
    if (ev.data === "[DONE]") {
      yield { data: "[DONE]" }
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(ev.data)
    } catch {
      continue
    }
    const chunks: Array<ChatCompletionChunk> =
      translateResponsesEventToChatChunks(parsed, state)
    for (const c of chunks) {
      yield { data: JSON.stringify(c) }
    }
  }
  yield { data: "[DONE]" }
}
