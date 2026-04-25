import { test, expect, describe } from "bun:test"

import { AccountPool, type Account } from "../src/lib/account-pool"

const makeAccount = (overrides: Partial<Account> = {}): Account => ({
  name: "a",
  accountType: "individual",
  githubToken: "ghu_a",
  copilotToken: "tok_a",
  copilotTokenRefreshAt: 0,
  inFlight: 0,
  lastUsedAt: 0,
  failureCount: 0,
  ...overrides,
})

describe("AccountPool", () => {
  test("pick throws when no usable accounts", () => {
    const pool = new AccountPool([], "round-robin")
    expect(() => pool.pick()).toThrow()
  })

  test("pick returns account with copilot token", () => {
    const a1 = makeAccount({ name: "a1", copilotToken: undefined })
    const a2 = makeAccount({ name: "a2", copilotToken: "tok2" })
    const pool = new AccountPool([a1, a2], "round-robin")
    expect(pool.pick().name).toBe("a2")
  })

  test("round-robin rotates", () => {
    const a1 = makeAccount({ name: "a1" })
    const a2 = makeAccount({ name: "a2" })
    const a3 = makeAccount({ name: "a3" })
    const pool = new AccountPool([a1, a2, a3], "round-robin")
    const order = [
      pool.pick().name,
      pool.pick().name,
      pool.pick().name,
      pool.pick().name,
    ]
    expect(order).toEqual(["a1", "a2", "a3", "a1"])
  })

  test("least-busy prefers lowest inFlight then oldest lastUsedAt", () => {
    const a1 = makeAccount({ name: "a1", inFlight: 2, lastUsedAt: 100 })
    const a2 = makeAccount({ name: "a2", inFlight: 1, lastUsedAt: 200 })
    const a3 = makeAccount({ name: "a3", inFlight: 1, lastUsedAt: 50 })
    const pool = new AccountPool([a1, a2, a3], "least-busy")
    expect(pool.pick().name).toBe("a3")
  })

  test("least-recent picks oldest lastUsedAt", () => {
    const a1 = makeAccount({ name: "a1", lastUsedAt: 200 })
    const a2 = makeAccount({ name: "a2", lastUsedAt: 50 })
    const pool = new AccountPool([a1, a2], "least-recent")
    expect(pool.pick().name).toBe("a2")
  })

  test("cooldown account is excluded; comes back on expiry", () => {
    const now = Date.now()
    const a1 = makeAccount({ name: "a1", cooldownUntil: now + 60_000 })
    const a2 = makeAccount({ name: "a2" })
    const pool = new AccountPool([a1, a2], "round-robin")
    expect(pool.pick().name).toBe("a2")
    expect(pool.pick().name).toBe("a2")
    // expire cooldown
    a1.cooldownUntil = now - 1
    const seen = new Set([pool.pick().name, pool.pick().name])
    expect(seen.has("a1")).toBe(true)
  })

  test("acquire/release tracks inFlight and lastUsedAt", () => {
    const a = makeAccount({ name: "a" })
    const pool = new AccountPool([a], "round-robin")
    const acquired = pool.acquire()
    expect(acquired.inFlight).toBe(1)
    pool.release(acquired)
    expect(acquired.inFlight).toBe(0)
    expect(acquired.lastUsedAt).toBeGreaterThan(0)
  })

  test("markCooldown sets cooldownUntil", () => {
    const a = makeAccount({ name: "a" })
    const pool = new AccountPool([a], "round-robin")
    pool.markCooldown(a, 5000)
    expect(a.cooldownUntil).toBeGreaterThan(Date.now())
  })

  test("markFailure increments failureCount", () => {
    const a = makeAccount({ name: "a" })
    const pool = new AccountPool([a], "round-robin")
    pool.markFailure(a)
    pool.markFailure(a)
    expect(a.failureCount).toBe(2)
  })
})
