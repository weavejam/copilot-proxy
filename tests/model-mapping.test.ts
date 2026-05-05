import type { Context } from "hono"

import { describe, expect, test } from "bun:test"

import type { Model } from "~/services/copilot/get-models"

import {
  jaccardSimilarity,
  mapModelIdToAvailableModels,
  normalizeClaudeModelVersion,
  resolveModelId,
} from "../src/lib/utils"

function makeContext(anthropicBeta?: string): Context {
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === "anthropic-beta" ? anthropicBeta : undefined,
    },
  } as unknown as Context
}

describe("model mapping", () => {
  test("normalizes Claude numeric segments from hyphen to dot", () => {
    expect(normalizeClaudeModelVersion("claude-opus-4-6")).toBe(
      "claude-opus-4.6",
    )
    expect(normalizeClaudeModelVersion("claude-3-5-sonnet-20241022")).toBe(
      "claude-3.5-sonnet-20241022",
    )
  })

  test("does not change non-Claude models", () => {
    expect(normalizeClaudeModelVersion("gpt-4.1")).toBe("gpt-4.1")
  })

  test("appends -1m when anthropic-beta has context-1m", () => {
    const c = makeContext("foo,context-1m-2025-08-07,bar")
    expect(resolveModelId("claude-opus-4-6", c)).toBe("claude-opus-4.6-1m")
  })

  test("does not append -1m twice", () => {
    const c = makeContext("context-1m-2025-08-07")
    expect(resolveModelId("claude-opus-4.6-1m", c)).toBe("claude-opus-4.6-1m")
  })

  test("keeps normalized model when context-1m is absent", () => {
    const c = makeContext("claude-code-2025-02-19")
    expect(resolveModelId("claude-opus-4-6", c)).toBe("claude-opus-4.6")
  })

  test("calculates Jaccard similarity for fuzzy matching", () => {
    expect(jaccardSimilarity("claude-opus-4.6", "claude-opus-4.6")).toBe(1)
    expect(jaccardSimilarity("claude-opus-4.6", "gpt-4o")).toBeLessThan(0.3)
  })

  test("uses exact match before fuzzy matching", () => {
    const models = makeModels(["claude-opus-4.6", "claude-sonnet-4.5", "auto"])
    expect(mapModelIdToAvailableModels("claude-opus-4.6", models)).toBe(
      "claude-opus-4.6",
    )
  })

  test("uses fuzzy match when exact model is missing", () => {
    const models = makeModels(["claude-opus-4.6", "claude-sonnet-4.5", "auto"])
    expect(mapModelIdToAvailableModels("claude-opus-4-6", models)).toBe(
      "claude-opus-4.6",
    )
  })

  test("falls back to auto-version model when no fuzzy match", () => {
    const models = makeModels(["claude-opus-4.6", "auto", "gpt-4o"])
    expect(mapModelIdToAvailableModels("nonexistent-model", models)).toBe(
      "auto",
    )
  })

  test("falls back to first model when auto is unavailable", () => {
    const models = makeModels(["claude-opus-4.6", "gpt-4o"])
    expect(mapModelIdToAvailableModels("unknown-model", models)).toBe(
      "claude-opus-4.6",
    )
  })
})

function makeModel(id: string, version = "v1"): Model {
  return {
    id,
    version,
    name: id,
    vendor: "copilot",
    object: "model",
    preview: false,
    model_picker_enabled: true,
    capabilities: {
      family: id.includes("claude") ? "claude" : "other",
      limits: {},
      object: "model_capabilities",
      supports: {},
      tokenizer: "o200k_base",
      type: "chat",
    },
  }
}

function makeModels(ids: Array<string>): Array<Model> {
  const versions: Record<string, string> = {
    auto: "v-auto",
    "gpt-4o": "v-auto",
  }
  return ids.map((id) => makeModel(id, versions[id] ?? "v1"))
}
