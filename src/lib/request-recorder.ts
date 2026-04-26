import type { MiddlewareHandler } from "hono"

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export interface RecorderOptions {
  logDir: string
  requestHeaders: boolean
  requestBody: boolean
  responseHeaders: boolean
  responseBody: boolean
}

/**
 * Get the directory for the current minute: {logDir}/YYYYMMDD_HHmm00
 */
function getMinuteDir(logDir: string): string {
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  const h = String(now.getHours()).padStart(2, "0")
  const mi = String(now.getMinutes()).padStart(2, "0")
  return path.join(logDir, `${y}${mo}${d}_${h}${mi}00`)
}

/**
 * Build a per-request directory inside the minute directory.
 */
function getRequestDir(
  logDir: string,
  method: string,
  urlPath: string,
): string {
  const ts = Date.now()
  const safePath =
    encodeURIComponent(urlPath.replace(/^\//, "")).slice(0, 200) || "root"
  const dirName = `${ts}_${method}_${safePath}`
  const minuteDir = getMinuteDir(logDir)
  const requestDir = path.join(minuteDir, dirName)
  mkdirSync(requestDir, { recursive: true })
  return requestDir
}

function getFileExtension(contentType: string | null): string {
  if (!contentType) return "bin"
  const mime = contentType.toLowerCase().split(";")[0].trim()
  const map: Record<string, string> = {
    "application/json": "json",
    "text/html": "html",
    "text/plain": "txt",
    "text/event-stream": "txt",
    "text/css": "css",
    "text/javascript": "js",
    "application/javascript": "js",
    "application/xml": "xml",
    "text/xml": "xml",
  }
  return map[mime] ?? "bin"
}

function redactHeaders(raw: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of raw.entries()) {
    out[k] = k.toLowerCase() === "authorization" ? v.slice(0, 20) + "..." : v
  }
  return out
}

function saveJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8")
}

interface SaveBodyOpts {
  dir: string
  prefix: string
  buf: ArrayBuffer
  contentType: string | null
}

function saveBody(opts: SaveBodyOpts): void {
  const { dir, prefix, buf, contentType } = opts
  if (buf.byteLength === 0) return
  const ext = getFileExtension(contentType)
  const bytes = Buffer.from(buf)
  if (ext === "json") {
    try {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"))
      saveJson(path.join(dir, `${prefix}.json`), parsed)
      return
    } catch {
      // fall through to raw write
    }
  }
  writeFileSync(path.join(dir, `${prefix}.${ext}`), bytes)
}

/**
 * Hono middleware that records request/response data to per-request directories.
 */
export function requestRecorder(opts: RecorderOptions): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method
    const url = new URL(c.req.url)
    const urlPath = url.pathname + url.search

    let requestDir: string | undefined

    try {
      requestDir = getRequestDir(opts.logDir, method, urlPath)

      // Request headers
      if (opts.requestHeaders) {
        saveJson(path.join(requestDir, "request_headers.json"), {
          method,
          url: c.req.url,
          headers: redactHeaders(c.req.raw.headers),
          timestamp: new Date().toISOString(),
        })
      }

      // Request body — clone to avoid consuming the original
      if (opts.requestBody && method !== "GET" && method !== "HEAD") {
        try {
          const buf = await c.req.raw.clone().arrayBuffer()
          saveBody({
            dir: requestDir,
            prefix: "request_body",
            buf,
            contentType: c.req.header("content-type") ?? null,
          })
        } catch {
          // body read failure — non-critical
        }
      }
    } catch {
      // directory or write failure — non-critical
    }

    await next()

    // Response recording
    if (requestDir) {
      try {
        if (opts.responseHeaders) {
          const resHeaders: Record<string, string> = {}
          for (const [k, v] of c.res.headers.entries()) {
            resHeaders[k] = v
          }
          saveJson(path.join(requestDir, "response_headers.json"), {
            status: c.res.status,
            headers: resHeaders,
            timestamp: new Date().toISOString(),
          })
        }

        if (opts.responseBody) {
          try {
            const buf = await c.res.clone().arrayBuffer()
            saveBody({
              dir: requestDir,
              prefix: "response_body",
              buf,
              contentType: c.res.headers.get("content-type"),
            })
          } catch {
            // body read failure — non-critical
          }
        }
      } catch {
        // non-critical
      }
    }
  }
}

/** Parse --record-parts comma-separated string into boolean flags. */
export function parseRecordParts(raw: string): {
  requestHeaders: boolean
  requestBody: boolean
  responseHeaders: boolean
  responseBody: boolean
} {
  const parts = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
  return {
    requestHeaders: parts.has("req-header"),
    requestBody: parts.has("req-body"),
    responseHeaders: parts.has("res-header"),
    responseBody: parts.has("res-body"),
  }
}
