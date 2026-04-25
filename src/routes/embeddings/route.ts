import { Hono } from "hono"

import type { Account } from "~/lib/account-pool"

import { forwardError } from "~/lib/error"
import {
  normalizeEmbeddings,
  type NormalizedUsage,
} from "~/lib/usage-normalizer"
import { recordUsage } from "~/lib/usage-recorder"
import { makeApiContext } from "~/lib/utils"
import { withAccount } from "~/lib/with-account"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "~/services/copilot/create-embeddings"

const ZERO_USAGE: NormalizedUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

export const embeddingRoutes = new Hono()

embeddingRoutes.post("/", async (c) => {
  const isInternal = c.req.header("x-internal-pricing-sync") === "1"
  const tStart = Date.now()
  let usedAccount: Account | undefined
  let modelId = ""

  try {
    const payload = await c.req.json<EmbeddingRequest>()
    modelId = payload.model
    const response = await withAccount(c, (account) => {
      usedAccount = account
      return createEmbeddings(makeApiContext(account), payload)
    })
    if (usedAccount) {
      recordUsage({
        account: usedAccount,
        modelId,
        endpoint: "embeddings",
        upstreamFormat: "openai",
        isStreaming: false,
        usage: normalizeEmbeddings(response.usage),
        durationMs: Date.now() - tStart,
        status: "ok",
        isInternal,
      })
    }
    return c.json(response)
  } catch (error) {
    if (usedAccount && modelId) {
      recordUsage({
        account: usedAccount,
        modelId,
        endpoint: "embeddings",
        upstreamFormat: "openai",
        isStreaming: false,
        usage: ZERO_USAGE,
        durationMs: Date.now() - tStart,
        status: "error",
        isInternal,
      })
    }
    return await forwardError(c, error)
  }
})
