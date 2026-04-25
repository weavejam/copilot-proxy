import { test, expect, describe, beforeEach, mock } from "bun:test"

import { AccountPool, type Account } from "../src/lib/account-pool"
import { HTTPError } from "../src/lib/error"
import { state } from "../src/lib/state"
import { withAccount } from "../src/lib/with-account"

// Stub out token refresh so 401 retries don't hit the network.
void mock.module("../src/lib/token", () => ({
  setupCopilotTokenFor: async (_a: Account) => {
    /* no-op */
  },
}))

const makeAccount = (name: string): Account => ({
  name,
  accountType: "individual",
  githubToken: `ghu_${name}`,
  copilotToken: `tok_${name}`,
  copilotTokenRefreshAt: 0,
  inFlight: 0,
  lastUsedAt: 0,
  failureCount: 0,
})

const fakeResp = (status: number) => new Response("err", { status })

describe("withAccount", () => {
  beforeEach(() => {
    state.pool = new AccountPool(
      [makeAccount("a"), makeAccount("b")],
      "round-robin",
    )
  })

  test("returns value on success without retry", async () => {
    const seen: Array<string> = []
    const out = await withAccount(undefined, (account) => {
      seen.push(account.name)
      return Promise.resolve(42)
    })
    expect(out).toBe(42)
    expect(seen).toHaveLength(1)
  })

  test("retries on 5xx with a different account, then succeeds", async () => {
    const seen: Array<string> = []
    const out = await withAccount(undefined, (account) => {
      seen.push(account.name)
      if (seen.length === 1) {
        return Promise.reject(new HTTPError("upstream 503", fakeResp(503)))
      }
      return Promise.resolve("ok")
    })
    expect(out).toBe("ok")
    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
    // First account should be on cooldown
    const first = state.pool?.accounts[0]
    expect(first?.cooldownUntil ?? 0).toBeGreaterThan(Date.now())
  })

  test("4xx client error (non-401) does not retry", async () => {
    const seen: Array<string> = []
    const promise = withAccount(undefined, (account) => {
      seen.push(account.name)
      return Promise.reject(new HTTPError("bad request", fakeResp(400)))
    })
    let thrown: unknown
    try {
      await promise
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(HTTPError)
    expect(seen).toHaveLength(1)
  })

  test("401 triggers refresh and retries on a different account", async () => {
    const seen: Array<string> = []
    const out = await withAccount(undefined, (account) => {
      seen.push(account.name)
      if (seen.length === 1) {
        return Promise.reject(new HTTPError("auth", fakeResp(401)))
      }
      return Promise.resolve("ok-after-refresh")
    })
    expect(out).toBe("ok-after-refresh")
    expect(seen).toHaveLength(2)
  })

  test("retries cap at pool size", async () => {
    const calls: Array<string> = []
    const promise = withAccount(undefined, (account) => {
      calls.push(account.name)
      return Promise.reject(new HTTPError("upstream 502", fakeResp(502)))
    })
    let thrown: unknown
    try {
      await promise
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(HTTPError)
    // 2 accounts ⇒ exactly 2 attempts
    expect(calls).toHaveLength(2)
  })
})
