import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import type { Account } from "~/lib/account-pool"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import {
  createOpenAIAccumulator,
  normalizeOpenAIFinal,
  UsageMissingError,
  type NormalizedUsage,
  type StreamUsageAccumulator,
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

interface RecordContext {
  account: Account
  modelId: string
  isInternal: boolean
  tStart: number
}

function feedFrame(
  rawEvent: { data?: string },
  accumulator: StreamUsageAccumulator,
): string | undefined {
  if (!rawEvent.data || rawEvent.data === "[DONE]") return undefined
  try {
    const parsed = JSON.parse(rawEvent.data) as {
      id?: string
      usage?: unknown
    }
    accumulator.feed(parsed)
    return parsed.id
  } catch {
    return undefined
  }
}

function finalizeStreamUsage(
  accumulator: StreamUsageAccumulator,
  status: "ok" | "error" | "aborted",
): { usage: NormalizedUsage; status: "ok" | "error" | "aborted" } {
  try {
    return { usage: accumulator.finalize(), status }
  } catch (err) {
    if (err instanceof UsageMissingError) {
      consola.warn(
        "Streaming completed without an include_usage frame; recording zero usage",
      )
    } else {
      consola.error("Failed to finalize stream usage:", err)
    }
    return {
      usage: ZERO_USAGE,
      status: status === "ok" ? "error" : status,
    }
  }
}

function streamAndRecord(
  c: Context,
  response: AsyncIterable<{ data?: string }>,
  ctx: RecordContext,
) {
  return streamSSE(c, async (stream) => {
    const accumulator = createOpenAIAccumulator()
    let status: "ok" | "error" | "aborted" = "ok"
    let lastRequestId: string | undefined
    try {
      for await (const rawEvent of response) {
        if (c.req.raw.signal.aborted) {
          status = "aborted"
          break
        }
        const id = feedFrame(rawEvent, accumulator)
        if (id) lastRequestId = id
        consola.debug("Streaming chunk:", JSON.stringify(rawEvent))
        await stream.writeSSE(rawEvent as SSEMessage)
      }
    } catch (err) {
      status = "error"
      consola.error("Streaming chat-completions error:", err)
    }

    const result = finalizeStreamUsage(accumulator, status)
    recordUsage({
      account: ctx.account,
      modelId: ctx.modelId,
      endpoint: "chat.completions",
      upstreamFormat: "openai",
      isStreaming: true,
      usage: result.usage,
      durationMs: Date.now() - ctx.tStart,
      status: result.status,
      requestId: lastRequestId,
      isInternal: ctx.isInternal,
    })
  })
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
  if (!usedAccount) {
    // Should never happen — withAccount always invokes the callback.
    return streamSSE(c, async (stream) => {
      for await (const chunk of response) {
        await stream.writeSSE(chunk as SSEMessage)
      }
    })
  }
  return streamAndRecord(c, response, {
    account: usedAccount,
    modelId: payload.model,
    isInternal,
    tStart,
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
