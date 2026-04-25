import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import { makeApiContext } from "~/lib/utils"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "~/services/copilot/create-embeddings"

export const embeddingRoutes = new Hono()

embeddingRoutes.post("/", async (c) => {
  try {
    const paylod = await c.req.json<EmbeddingRequest>()
    if (!state.pool) throw new Error("Account pool not initialized")
    const account = state.pool.acquire()
    try {
      const response = await createEmbeddings(makeApiContext(account), paylod)
      return c.json(response)
    } finally {
      state.pool.release(account)
    }
  } catch (error) {
    return await forwardError(c, error)
  }
})
