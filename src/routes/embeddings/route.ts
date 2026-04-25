import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { makeApiContext } from "~/lib/utils"
import { withAccount } from "~/lib/with-account"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "~/services/copilot/create-embeddings"

export const embeddingRoutes = new Hono()

embeddingRoutes.post("/", async (c) => {
  try {
    const paylod = await c.req.json<EmbeddingRequest>()
    const response = await withAccount(c, (account) =>
      createEmbeddings(makeApiContext(account), paylod),
    )
    return c.json(response)
  } catch (error) {
    return await forwardError(c, error)
  }
})
