import type { Context } from "hono"

import consola from "consola"
import { events } from "fetch-event-stream"
import { streamSSE } from "hono/streaming"

import type { Account } from "~/lib/account-pool"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createResponsesAccumulator,
  normalizeResponsesFinal,
  UsageMissingError,
  type NormalizedUsage,
} from "~/lib/usage-normalizer"
import { recordUsage } from "~/lib/usage-recorder"
import { makeApiContext, resolveAndMapModelId } from "~/lib/utils"
import { withAccount } from "~/lib/with-account"

const ZERO_USAGE: NormalizedUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

interface ResponsesRequestBody {
  model?: string
  stream?: boolean
  [key: string]: unknown
}

interface CallContext {
  account: Account
  modelId: string
  isInternal: boolean
  tStart: number
}

async function fetchResponses(
  account: Account,
  payload: ResponsesRequestBody,
  modelId: string,
): Promise<Response> {
  const ctx = makeApiContext(account)
  const headers: Record<string, string> = {
    ...copilotHeaders(ctx, false),
  }
  const res = await fetch(`${copilotBaseUrl(ctx)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    consola.error("Failed to call /responses", res)
    throw new HTTPError("Failed to call /responses", res)
  }
  state.modelEndpointRoute.set(modelId, "responses")
  return res
}

async function handleNonStream(
  c: Context,
  upstream: Response,
  cc: CallContext,
) {
  const text = await upstream.text()
  let parsed: { id?: string; usage?: unknown } | undefined
  try {
    parsed = JSON.parse(text) as { id?: string; usage?: unknown }
  } catch {
    parsed = undefined
  }
  const usage =
    parsed === undefined ? ZERO_USAGE : normalizeResponsesFinal(parsed.usage)
  recordUsage({
    account: cc.account,
    modelId: cc.modelId,
    endpoint: "responses",
    upstreamFormat: "openai",
    isStreaming: false,
    usage,
    durationMs: Date.now() - cc.tStart,
    status: "ok",
    requestId: parsed?.id,
    isInternal: cc.isInternal,
  })
  c.header("content-type", "application/json")
  return c.body(text)
}

function handleStream(c: Context, upstream: Response, cc: CallContext) {
  return streamSSE(c, async (stream) => {
    const accumulator = createResponsesAccumulator()
    let status: "ok" | "error" | "aborted" = "ok"
    let lastRequestId: string | undefined
    try {
      for await (const ev of events(upstream)) {
        if (stream.aborted) {
          status = "aborted"
          break
        }
        if (!ev.data) continue
        if (ev.data === "[DONE]") {
          await stream.writeSSE({ data: "[DONE]" })
          break
        }
        try {
          const parsed = JSON.parse(ev.data) as {
            type?: string
            response?: { id?: string }
          }
          accumulator.feed(parsed)
          if (parsed.response?.id) lastRequestId = parsed.response.id
        } catch {
          // ignore non-JSON frames
        }
        await stream.writeSSE({ event: ev.event, data: ev.data })
      }
    } catch (err) {
      status = "error"
      consola.error("Streaming /responses error:", err)
    }

    let usage: NormalizedUsage
    try {
      usage = accumulator.finalize()
    } catch (err) {
      if (!(err instanceof UsageMissingError)) {
        consola.error("Failed to finalize Responses stream usage:", err)
      }
      usage = ZERO_USAGE
      if (status === "ok") status = "error"
    }

    recordUsage({
      account: cc.account,
      modelId: cc.modelId,
      endpoint: "responses",
      upstreamFormat: "openai",
      isStreaming: true,
      usage,
      durationMs: Date.now() - cc.tStart,
      status,
      requestId: lastRequestId,
      isInternal: cc.isInternal,
    })
  })
}

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const incoming = await c.req.json<ResponsesRequestBody>()
  const requestedModel =
    typeof incoming.model === "string" ? incoming.model : ""
  const mappedModel = resolveAndMapModelId(
    requestedModel,
    c,
    state.models?.data ?? [],
  )
  const payload: ResponsesRequestBody = { ...incoming, model: mappedModel }
  const isStreaming = Boolean(payload.stream)
  const isInternal = c.req.header("x-internal-pricing-sync") === "1"
  const tStart = Date.now()

  let usedAccount: Account | undefined
  const upstream = await withAccount(c, async (account) => {
    usedAccount = account
    return await fetchResponses(account, payload, mappedModel)
  })

  if (!usedAccount) {
    // Should never happen — withAccount always invokes the callback.
    throw new Error("No account selected for /responses request")
  }

  const cc: CallContext = {
    account: usedAccount,
    modelId: mappedModel,
    isInternal,
    tStart,
  }

  if (!isStreaming) return await handleNonStream(c, upstream, cc)
  return handleStream(c, upstream, cc)
}
