import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

import type { RecorderOptions } from "./lib/request-recorder"

import { requestRecorder } from "./lib/request-recorder"
import { completionRoutes } from "./routes/chat-completions/route"
import { embeddingRoutes } from "./routes/embeddings/route"
import { messageRoutes } from "./routes/messages/route"
import { modelRoutes } from "./routes/models/route"
import { responsesRoutes } from "./routes/responses/route"
import { tokenRoute } from "./routes/token/route"
import { usageRoute } from "./routes/usage/route"

export interface ServerOptions {
  recorder?: RecorderOptions
}

export function createServer(options: ServerOptions = {}): Hono {
  const server = new Hono()

  server.use(logger())
  server.use(cors())

  // Request recorder must be registered before routes
  if (options.recorder) {
    server.use(requestRecorder(options.recorder))
  }

  server.get("/", (c) => c.text("Server running"))

  server.route("/chat/completions", completionRoutes)
  server.route("/models", modelRoutes)
  server.route("/embeddings", embeddingRoutes)
  server.route("/responses", responsesRoutes)
  server.route("/usage", usageRoute)
  server.route("/token", tokenRoute)

  // Compatibility with tools that expect v1/ prefix
  server.route("/v1/chat/completions", completionRoutes)
  server.route("/v1/models", modelRoutes)
  server.route("/v1/embeddings", embeddingRoutes)
  server.route("/v1/responses", responsesRoutes)

  // Anthropic compatible endpoints
  server.route("/v1/messages", messageRoutes)

  return server
}
