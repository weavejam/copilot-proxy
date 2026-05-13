import consola from "consola"

import type { ApiContext } from "~/lib/api-config"

import { HTTPError } from "~/lib/error"
import { state, type CopilotUpstreamEndpoint } from "~/lib/state"

import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "./create-chat-completions"
import { createResponses } from "./create-responses"

type Result = ChatCompletionResponse | AsyncIterable<{ data?: string }>

/**
 * Pick the default upstream endpoint for a model.
 *
 * GitHub Copilot's gpt-5* family (gpt-5, gpt-5-mini, gpt-5.4, gpt-5.4-mini,
 * gpt-5-codex, …) is only reachable through `/responses`. Everything else
 * defaults to `/chat/completions`.
 */
function defaultEndpointFor(modelId: string): CopilotUpstreamEndpoint {
  const id = modelId.toLowerCase()
  if (id.startsWith("gpt-5")) return "responses"
  return "chat"
}

/**
 * Returns true when the upstream error is the well-known
 * `unsupported_api_for_model` 400 — the signal that we picked the wrong
 * endpoint and should flip.
 */
async function isUnsupportedApiError(err: unknown): Promise<boolean> {
  if (!(err instanceof HTTPError)) return false
  if (err.response.status !== 400) return false
  try {
    const text = await err.response.clone().text()
    return text.includes("unsupported_api_for_model")
  } catch {
    return false
  }
}

async function call(
  endpoint: CopilotUpstreamEndpoint,
  ctx: ApiContext,
  payload: ChatCompletionsPayload,
): Promise<Result> {
  return endpoint === "responses" ?
      createResponses(ctx, payload)
    : createChatCompletions(ctx, payload)
}

/**
 * Dispatch a chat-completions style request to whichever Copilot endpoint
 * (`/chat/completions` or `/responses`) the given model actually supports.
 *
 * Decision order:
 *   1. If we've previously observed this model succeed on an endpoint, use it.
 *   2. Otherwise pick by name (gpt-5* → responses, else chat).
 *   3. On `unsupported_api_for_model` 400, flip endpoints once and retry.
 * Successful endpoint is memoized in `state.modelEndpointRoute` for the rest
 * of the process lifetime.
 */
export async function dispatchChatCompletion(
  ctx: ApiContext,
  payload: ChatCompletionsPayload,
): Promise<Result> {
  const remembered = state.modelEndpointRoute.get(payload.model)
  const primary = remembered ?? defaultEndpointFor(payload.model)

  try {
    const result = await call(primary, ctx, payload)
    state.modelEndpointRoute.set(payload.model, primary)
    return result
  } catch (err) {
    if (!(await isUnsupportedApiError(err))) throw err

    const fallback: CopilotUpstreamEndpoint =
      primary === "responses" ? "chat" : "responses"
    consola.warn(
      `Model "${payload.model}" rejected on /${
        primary === "chat" ? "chat/completions" : "responses"
      } with unsupported_api_for_model; retrying on /${
        fallback === "chat" ? "chat/completions" : "responses"
      }`,
    )
    const result = await call(fallback, ctx, payload)
    state.modelEndpointRoute.set(payload.model, fallback)
    return result
  }
}
