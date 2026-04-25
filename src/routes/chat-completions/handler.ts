import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import type { Account } from "~/lib/account-pool"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import {
  normalizeOpenAIFinal,
  type NormalizedUsage,
} from "~/lib/usage-normalizer"
import { recordUsage } from "~/lib/usage-recorder"
import { isNullish, makeApiContext, resolveAndMapModelId } from "~/lib/utils"
import { withAccount } from "~/lib/with-account"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

const ZERO_USAGE: NormalizedUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  payload = {
    ...payload,
    model: resolveAndMapModelId(payload.model, c, state.models?.data ?? []),
  }
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  const isInternal = c.req.header("x-internal-pricing-sync") === "1"
  const tStart = Date.now()
  let usedAccount: Account | undefined

  let response: Awaited<ReturnType<typeof createChatCompletions>>
  try {
    response = await withAccount(c, (account) => {
      usedAccount = account
      return createChatCompletions(makeApiContext(account), payload)
    })
  } catch (err) {
    if (usedAccount) {
      recordUsage({
        account: usedAccount,
        modelId: payload.model,
        endpoint: "chat.completions",
        upstreamFormat: "openai",
        isStreaming: Boolean(payload.stream),
        usage: ZERO_USAGE,
        durationMs: Date.now() - tStart,
        status: "error",
        isInternal,
      })
    }
    throw err
  }

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    if (usedAccount) {
      recordUsage({
        account: usedAccount,
        modelId: payload.model,
        endpoint: "chat.completions",
        upstreamFormat: "openai",
        isStreaming: false,
        usage: normalizeOpenAIFinal(response.usage),
        durationMs: Date.now() - tStart,
        status: "ok",
        requestId: response.id,
        isInternal,
      })
    }
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
