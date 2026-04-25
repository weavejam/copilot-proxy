import { test, expect, describe, beforeEach } from "bun:test"

import type { ModelsResponse } from "../src/services/copilot/get-models"

import {
  pickSyncModel,
  priceChanged,
  sanityFails,
  type PricingField,
} from "../src/lib/pricing-sync"
import { state } from "../src/lib/state"

const ZERO = (): Record<PricingField, number | null> => ({
  input_per_mtok: null,
  cached_input_per_mtok: null,
  output_per_mtok: null,
  reasoning_per_mtok: null,
  premium_multiplier: null,
  premium_unit_price: null,
})

describe("priceChanged", () => {
  test("returns true when old row missing", () => {
    expect(priceChanged(null, ZERO())).toBe(true)
  })

  test("returns false when both rows are equal", () => {
    const a = { ...ZERO(), input_per_mtok: 5 }
    expect(priceChanged(a, { ...ZERO(), input_per_mtok: 5 })).toBe(false)
  })

  test("returns false when change is below 0.5%", () => {
    const a = { ...ZERO(), input_per_mtok: 100 }
    const b = { ...ZERO(), input_per_mtok: 100.4 }
    expect(priceChanged(a, b)).toBe(false)
  })

  test("returns true when change is at or above 0.5%", () => {
    const a = { ...ZERO(), input_per_mtok: 100 }
    const b = { ...ZERO(), input_per_mtok: 100.5 }
    expect(priceChanged(a, b)).toBe(true)
  })

  test("returns true when one side is null and the other not", () => {
    const a = { ...ZERO(), input_per_mtok: 5 }
    const b = ZERO()
    expect(priceChanged(a, b)).toBe(true)
  })

  test("returns false when both sides are null for all fields", () => {
    expect(priceChanged(ZERO(), ZERO())).toBe(false)
  })

  test("returns true when one zero and one non-zero", () => {
    const a = { ...ZERO(), input_per_mtok: 0 }
    const b = { ...ZERO(), input_per_mtok: 5 }
    expect(priceChanged(a, b)).toBe(true)
  })
})

describe("sanityFails", () => {
  test("returns false on first entry (no oldRow)", () => {
    expect(sanityFails(null, { ...ZERO(), input_per_mtok: 100 })).toBe(false)
  })

  test("passes on within-bounds change (10x boundary)", () => {
    const a = { ...ZERO(), input_per_mtok: 1 }
    const b = { ...ZERO(), input_per_mtok: 9.99 }
    expect(sanityFails(a, b)).toBe(false)
  })

  test("fails when change exceeds 10x", () => {
    const a = { ...ZERO(), input_per_mtok: 1 }
    const b = { ...ZERO(), input_per_mtok: 100 }
    expect(sanityFails(a, b)).toBe(true)
  })

  test("fails when change drops below 1/10x", () => {
    const a = { ...ZERO(), input_per_mtok: 100 }
    const b = { ...ZERO(), input_per_mtok: 5 }
    expect(sanityFails(a, b)).toBe(true)
  })

  test("ignores fields where either side is null or zero", () => {
    const a = { ...ZERO(), input_per_mtok: 1 }
    const b = { ...ZERO(), output_per_mtok: 100 }
    expect(sanityFails(a, b)).toBe(false)
  })
})

describe("pickSyncModel", () => {
  beforeEach(() => {
    const data = [
      { id: "gpt-4o" },
      { id: "claude-sonnet-4" },
      { id: "gpt-3.5-turbo" },
    ] as unknown as ModelsResponse["data"]
    state.models = { object: "list", data }
  })

  test("returns CLI flag when present in models", () => {
    expect(pickSyncModel("gpt-4o")).toBe("gpt-4o")
  })

  test("falls back to whitelist when CLI flag is unknown", () => {
    expect(pickSyncModel("does-not-exist")).toBe("gpt-4o")
  })

  test("falls back to first model when no whitelist match", () => {
    const data = [{ id: "exotic-model" }] as unknown as ModelsResponse["data"]
    state.models = { object: "list", data }
    expect(pickSyncModel(undefined)).toBe("exotic-model")
  })
})
