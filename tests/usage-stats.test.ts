import { test, expect, describe, beforeEach } from "bun:test"

import type { Account } from "../src/lib/account-pool"

import { __resetDbForTests, getDb, initDb } from "../src/lib/db"
import { recordUsage } from "../src/lib/usage-recorder"
import { computeUsageStats } from "../src/lib/usage-stats"

const ACCOUNT: Account = {
  name: "alice",
  accountType: "individual",
  githubToken: "ghu_a",
  copilotToken: "tok_a",
  copilotTokenRefreshAt: 0,
  inFlight: 0,
  lastUsedAt: 0,
  failureCount: 0,
}

function setupDb() {
  __resetDbForTests()
  const db = initDb(":memory:")
  db.prepare(
    "INSERT INTO accounts (name, account_type, created_at) VALUES (?, ?, ?)",
  ).run(ACCOUNT.name, ACCOUNT.accountType, Date.now())
  db.prepare(
    `INSERT INTO model_pricing (
        model_id, input_per_mtok, cached_input_per_mtok, output_per_mtok,
        reasoning_per_mtok, premium_multiplier, premium_unit_price, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("gpt-4o", 2, 0, 8, 0, 1, 0.04, Date.now())
  return db
}

const baseRecord = {
  account: ACCOUNT,
  modelId: "gpt-4o",
  endpoint: "chat.completions" as const,
  upstreamFormat: "openai" as const,
  isStreaming: false,
  durationMs: 100,
  status: "ok" as const,
}

describe("computeUsageStats", () => {
  beforeEach(() => {
    __resetDbForTests()
  })

  test("historical lens computes cost from snapshots", () => {
    setupDb()
    recordUsage({
      ...baseRecord,
      usage: {
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 500_000,
        reasoningTokens: 0,
        totalTokens: 1_500_000,
      },
    })
    const stats = computeUsageStats({
      from: 0,
      to: Date.now() + 1,
      lens: "historical",
    })
    expect(stats.totals.token.input).toBe(1_000_000)
    expect(stats.totals.token.output).toBe(500_000)
    // 1M * $2 + 0.5M * $8 = $2 + $4 = $6
    expect(stats.totals.token.cost_usd).toBeCloseTo(6, 5)
    expect(stats.byAccount).toHaveLength(1)
    expect(stats.byAccount[0].byModel[0].model).toBe("gpt-4o")
  })

  test("current lens uses model_pricing live row", () => {
    setupDb()
    recordUsage({
      ...baseRecord,
      usage: {
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 1_000_000,
      },
    })
    // Bump live pricing
    getDb()
      .prepare("UPDATE model_pricing SET input_per_mtok = ? WHERE model_id = ?")
      .run(10, "gpt-4o")
    const stats = computeUsageStats({
      from: 0,
      to: Date.now() + 1,
      lens: "current",
    })
    // Now $10 per Mtok input → cost = $10
    expect(stats.totals.token.cost_usd).toBeCloseTo(10, 5)
  })

  test("missing_pricing lists models with usage but no pricing row", () => {
    setupDb()
    recordUsage({
      ...baseRecord,
      modelId: "unknown-model",
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 1,
      },
    })
    const stats = computeUsageStats({
      from: 0,
      to: Date.now() + 1,
      lens: "historical",
    })
    expect(stats.missing_pricing).toContain("unknown-model")
  })

  test("filter by endpoint narrows the result", () => {
    setupDb()
    recordUsage({
      ...baseRecord,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 100,
      },
    })
    recordUsage({
      ...baseRecord,
      endpoint: "embeddings",
      usage: {
        inputTokens: 50,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 50,
      },
    })
    const allStats = computeUsageStats({
      from: 0,
      to: Date.now() + 1,
      lens: "historical",
    })
    expect(allStats.totals.token.input).toBe(150)

    const embeddingsOnly = computeUsageStats({
      from: 0,
      to: Date.now() + 1,
      lens: "historical",
      endpoint: "embeddings",
    })
    expect(embeddingsOnly.totals.token.input).toBe(50)
  })
})
