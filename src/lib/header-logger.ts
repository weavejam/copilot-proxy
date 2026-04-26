import type { MiddlewareHandler } from "hono"

import { appendFileSync } from "node:fs"

import { PATHS } from "./paths"

/**
 * Hono middleware that logs every request's method, URL, and headers
 * to ~/.local/share/copilot-api/headers.log in a human-readable format.
 */
export function headerLogger(): MiddlewareHandler {
  return async (c, next) => {
    const ts = new Date().toISOString()
    const method = c.req.method
    const url = c.req.url

    const headers: Record<string, string> = {}
    for (const [k, v] of c.req.raw.headers.entries()) {
      // Redact authorization tokens for safety
      headers[k] =
        k.toLowerCase() === "authorization" ? v.slice(0, 20) + "..." : v
    }

    const line = [
      `\n--- ${ts} ${method} ${url} ---`,
      JSON.stringify(headers, null, 2),
      "",
    ].join("\n")

    try {
      appendFileSync(PATHS.HEADER_LOG_PATH, line, "utf8")
    } catch {
      // Non-critical — don't crash if write fails
    }

    await next()
  }
}
