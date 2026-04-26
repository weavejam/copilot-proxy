import { test, expect, describe, beforeEach } from "bun:test"

import { __resetDbForTests, getDb, initDb } from "../src/lib/db"
import { runPricingSync } from "../src/lib/pricing-sync-runner"

const PORT = 4141

function setupDb() {
  __resetDbForTests()
  initDb(":memory:")
}

const baseModel = (id: string, input: number, output: number) => ({
  model_id: id,
  input_per_mtok: input,
  cached_input_per_mtok: 0,
  output_per_mtok: output,
  reasoning_per_mtok: null,
  premium_multiplier: 1,
  premium_unit_price: 0.04,
  currency: "USD",
  source: "azure-retail",
  source_skus: ["sku1"],
})

describe("runPricingSync", () => {
  beforeEach(() => {
    setupDb()
  })

  test("first sync inserts version + materialized rows", async () => {
    const out = await runPricingSync({
      port: PORT,
      parsedOverride: { models: [baseModel("gpt-4o", 5, 15)] },
    })
    expect(out.status).toBe("ok")
    expect(out.updated).toBe(1)

    const versions = getDb()
      .prepare("SELECT COUNT(*) AS count FROM model_pricing_versions")
      .get() as { count: number } | undefined
    expect(versions?.count).toBe(1)

    const live = getDb()
      .prepare(
        "SELECT input_per_mtok FROM model_pricing WHERE model_id = 'gpt-4o'",
      )
      .get() as { input_per_mtok: number } | undefined
    expect(live?.input_per_mtok).toBe(5)
  })

  test("identical second sync writes zero new versions", async () => {
    await runPricingSync({
      port: PORT,
      parsedOverride: { models: [baseModel("gpt-4o", 5, 15)] },
    })
    const r2 = await runPricingSync({
      port: PORT,
      parsedOverride: { models: [baseModel("gpt-4o", 5, 15)] },
    })
    expect(r2.updated).toBe(0)
    const versions = getDb()
      .prepare("SELECT COUNT(*) AS count FROM model_pricing_versions")
      .get() as { count: number } | undefined
    expect(versions?.count).toBe(1)
  })

  test("changed price patches old effective_to and inserts new version", async () => {
    await runPricingSync({
      port: PORT,
      parsedOverride: { models: [baseModel("gpt-4o", 5, 15)] },
    })
    const r2 = await runPricingSync({
      port: PORT,
      parsedOverride: { models: [baseModel("gpt-4o", 5.5, 15)] }, // 10% change
    })
    expect(r2.updated).toBe(1)
    const rows = getDb()
      .prepare(
        "SELECT effective_to, input_per_mtok FROM model_pricing_versions ORDER BY id",
      )
      .all() as Array<{ effective_to: number | null; input_per_mtok: number }>
    expect(rows).toHaveLength(2)
    expect(rows[0].effective_to).not.toBeNull()
    expect(rows[1].effective_to).toBeNull()
    expect(rows[1].input_per_mtok).toBeCloseTo(5.5)
  })

  test("10x change rejects the whole sync", async () => {
    await runPricingSync({
      port: PORT,
      parsedOverride: { models: [baseModel("gpt-4o", 1, 15)] },
    })
    const r2 = await runPricingSync({
      port: PORT,
      parsedOverride: {
        models: [baseModel("gpt-4o", 100, 15)], // 100x → fails
      },
    })
    expect(r2.status).toBe("rejected")
    expect(r2.updated).toBe(0)
    const live = getDb()
      .prepare(
        "SELECT input_per_mtok FROM model_pricing WHERE model_id = 'gpt-4o'",
      )
      .get() as { input_per_mtok: number } | undefined
    expect(live?.input_per_mtok).toBe(1) // unchanged
  })
})
