import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import type { Account } from "~/lib/account-pool"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createOpenAIAccumulator,
  normalizeOpenAIFinal,
  UsageMissingError,
  type NormalizedUsage,
} from "~/lib/usage-normalizer"
import { recordUsage } from "~/lib/usage-recorder"
import { makeApiContext, resolveAndMapModelId } from "~/lib/utils"
import { withAccount } from "~/lib/with-account"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

const ZERO_USAGE: NormalizedUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

interface RecordCtx {
  account: Account
  modelId: string
  isInternal: boolean
  tStart: number
}

interface RecordOkArgs {
  ctx: RecordCtx
  usage: NormalizedUsage
  isStreaming: boolean
  requestId?: string
}

interface RecordFailureArgs {
  ctx: RecordCtx
  status: "error" | "aborted"
  isStreaming: boolean
  usage?: NormalizedUsage
}

function recordOk(args: RecordOkArgs) {
  recordUsage({
    account: args.ctx.account,
    modelId: args.ctx.modelId,
    endpoint: "messages",
    upstreamFormat: "anthropic",
    isStreaming: args.isStreaming,
    usage: args.usage,
    durationMs: Date.now() - args.ctx.tStart,
    status: "ok",
    requestId: args.requestId,
    isInternal: args.ctx.isInternal,
  })
}

function recordFailure(args: RecordFailureArgs) {
  recordUsage({
    account: args.ctx.account,
    modelId: args.ctx.modelId,
    endpoint: "messages",
    upstreamFormat: "anthropic",
    isStreaming: args.isStreaming,
    usage: args.usage ?? ZERO_USAGE,
    durationMs: Date.now() - args.ctx.tStart,
    status: args.status,
    isInternal: args.ctx.isInternal,
  })
}

function streamAndRecord(
  c: Context,
  response: AsyncIterable<{ data?: string }>,
  ctx: RecordCtx,
) {
  return streamSSE(c, async (stream) => {
    const accumulator = createOpenAIAccumulator()
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }
    let status: "ok" | "error" | "aborted" = "ok"
    let lastRequestId: string | undefined

    try {
      for await (const rawEvent of response) {
        if (stream.aborted) {
          status = "aborted"
          break
        }
        if (rawEvent.data === "[DONE]") break
        if (!rawEvent.data) continue

        const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
        if (chunk.id) lastRequestId = chunk.id
        accumulator.feed(chunk)

        const events = translateChunkToAnthropicEvents(chunk, streamState)
        for (const event of events) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          })
        }
      }
    } catch (err) {
      status = "error"
      consola.error("Streaming /v1/messages error:", err)
    }

    let usage: NormalizedUsage
    try {
      usage = accumulator.finalize()
    } catch (err) {
      if (err instanceof UsageMissingError) {
        consola.warn(
          "Anthropic stream completed without an include_usage frame; recording zero usage",
        )
      } else {
        consola.error("Failed to finalize Anthropic stream usage:", err)
      }
      usage = ZERO_USAGE
      if (status === "ok") status = "error"
    }

    if (status === "ok") {
      recordOk({ ctx, usage, isStreaming: true, requestId: lastRequestId })
    } else {
      recordFailure({ ctx, status, isStreaming: true, usage })
    }
  })
}

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  let openAIPayload = translateToOpenAI(anthropicPayload, c)
  openAIPayload = {
    ...openAIPayload,
    model: resolveAndMapModelId(
      openAIPayload.model,
      undefined,
      state.models?.data ?? [],
    ),
  }
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const isInternal = c.req.header("x-internal-pricing-sync") === "1"
  const tStart = Date.now()
  let usedAccount: Account | undefined

  let response: Awaited<ReturnType<typeof createChatCompletions>>
  try {
    response = await withAccount(c, (account) => {
      usedAccount = account
      return createChatCompletions(makeApiContext(account), openAIPayload)
    })
  } catch (err) {
    if (usedAccount) {
      recordFailure({
        ctx: {
          account: usedAccount,
          modelId: openAIPayload.model,
          isInternal,
          tStart,
        },
        status: "error",
        isStreaming: Boolean(openAIPayload.stream),
      })
    }
    throw err
  }

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    if (usedAccount) {
      recordOk({
        ctx: {
          account: usedAccount,
          modelId: openAIPayload.model,
          isInternal,
          tStart,
        },
        usage: normalizeOpenAIFinal(response.usage),
        isStreaming: false,
        requestId: response.id,
      })
    }
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  if (!usedAccount) {
    return streamSSE(c, async (stream) => {
      const streamState: AnthropicStreamState = {
        messageStartSent: false,
        contentBlockIndex: 0,
        contentBlockOpen: false,
        toolCalls: {},
      }
      for await (const rawEvent of response) {
        if (rawEvent.data === "[DONE]") break
        if (!rawEvent.data) continue
        const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
        for (const event of translateChunkToAnthropicEvents(
          chunk,
          streamState,
        )) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          })
        }
      }
    })
  }
  return streamAndRecord(c, response, {
    account: usedAccount,
    modelId: openAIPayload.model,
    isInternal,
    tStart,
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
