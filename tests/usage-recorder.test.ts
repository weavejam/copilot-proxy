import { test, expect, describe, beforeEach } from "bun:test"

import type { Account } from "../src/lib/account-pool"

import { __resetDbForTests, initDb } from "../src/lib/db"
import { recordUsage } from "../src/lib/usage-recorder"

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

const baseInput = {
  account: ACCOUNT,
  modelId: "gpt-4o",
  endpoint: "chat.completions" as const,
  upstreamFormat: "openai" as const,
  isStreaming: false,
  usage: {
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 50,
    reasoningTokens: 0,
    totalTokens: 150,
  },
  durationMs: 123,
  status: "ok" as const,
}

function setupDb() {
  __resetDbForTests()
  const db = initDb(":memory:")
  db.run(
    "INSERT INTO accounts (name, account_type, created_at) VALUES (?, ?, ?)",
    [ACCOUNT.name, ACCOUNT.accountType, Date.now()],
  )
  return db
}

describe("recordUsage", () => {
  beforeEach(() => {
    __resetDbForTests()
  })

  test("inserts an event and a daily row", () => {
    const db = setupDb()
    db.run(
      `INSERT INTO model_pricing (
         model_id, input_per_mtok, cached_input_per_mtok, output_per_mtok,
         reasoning_per_mtok, premium_multiplier, premium_unit_price,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["gpt-4o", 5, 1, 15, 0, 1.0, 0.04, Date.now()],
    )
    recordUsage(baseInput)

    const events = db.query("SELECT * FROM usage_events").all() as Array<{
      account_name: string
      model_id: string
      input_tokens: number
      input_price_snapshot: number
      premium_request_count: number
    }>
    expect(events).toHaveLength(1)
    expect(events[0].account_name).toBe("alice")
    expect(events[0].input_price_snapshot).toBe(5)
    expect(events[0].premium_request_count).toBe(1)

    const daily = db.query("SELECT * FROM usage_daily").all() as Array<{
      req_count: number
      input_tokens: number
      premium_requests: number
    }>
    expect(daily).toHaveLength(1)
    expect(daily[0].req_count).toBe(1)
    expect(daily[0].input_tokens).toBe(100)
    expect(daily[0].premium_requests).toBe(1)
  })

  test("second insert into same (day,account,model,endpoint) increments daily", () => {
    const db = setupDb()
    recordUsage(baseInput)
    recordUsage(baseInput)
    const daily = db
      .query<
        { req_count: number; input_tokens: number },
        []
      >("SELECT req_count, input_tokens FROM usage_daily")
      .all()
    expect(daily).toHaveLength(1)
    expect(daily[0].req_count).toBe(2)
    expect(daily[0].input_tokens).toBe(200)
  })

  test("missing model_pricing row -> snapshots null and no throw", () => {
    const db = setupDb()
    recordUsage(baseInput)
    const ev = db
      .query<
        { input_price_snapshot: number | null; premium_request_count: number },
        []
      >("SELECT input_price_snapshot, premium_request_count FROM usage_events")
      .get()
    expect(ev?.input_price_snapshot).toBeNull()
    expect(ev?.premium_request_count).toBe(0)
  })

  test("isInternal=true inserts nothing", () => {
    const db = setupDb()
    recordUsage({ ...baseInput, isInternal: true })
    const events = db.query("SELECT * FROM usage_events").all()
    expect(events).toHaveLength(0)
  })

  test("recorder errors are swallowed", () => {
    setupDb()
    // Force an error by passing an invalid endpoint type via cast.
    expect(() =>
      recordUsage({
        ...baseInput,
        // @ts-expect-error intentional bad value to trigger SQL CHECK fail (none here, but recorder must not throw on weird input)
        endpoint: undefined,
      }),
    ).not.toThrow()
  })
})
