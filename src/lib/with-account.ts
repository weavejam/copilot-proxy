import type { Context } from "hono"

import consola from "consola"

import type { AccountPool, Account } from "./account-pool"

import { HTTPError } from "./error"
import { state } from "./state"
import { setupCopilotTokenFor } from "./token"

const COOLDOWN_MS = 30_000
const MAX_RETRIES_CAP = 3

export interface WithAccountOptions {
  /** Override max retries (still capped by pool size). */
  maxRetries?: number
}

async function safeRefresh(account: Account): Promise<boolean> {
  try {
    await setupCopilotTokenFor(account)
    return true
  } catch (refreshErr) {
    consola.error(`[${account.name}] token refresh failed:`, refreshErr)
    return false
  }
}

/**
 * Handle one error from `fn(account)`.
 * Throws to bubble up immediately, returns nothing to continue the retry loop.
 */
async function handleAttemptError(
  pool: AccountPool,
  account: Account,
  err: unknown,
): Promise<void> {
  if (err instanceof HTTPError) {
    const { status } = err.response
    if (status === 401) {
      consola.warn(
        `[${account.name}] 401 from upstream; refreshing token and retrying`,
      )
      const ok = await safeRefresh(account)
      if (!ok) pool.markCooldown(account, COOLDOWN_MS)
      return
    }
    if (status >= 400 && status < 500) {
      // Client error — propagate without retry.
      throw err
    }
    // 5xx
    consola.warn(
      `[${account.name}] ${status} from upstream; cooling down ${COOLDOWN_MS}ms`,
    )
    pool.markCooldown(account, COOLDOWN_MS)
    return
  }

  // Non-HTTP error (network, timeout, etc.)
  consola.warn(`[${account.name}] non-HTTP error; cooling down`, err)
  pool.markCooldown(account, COOLDOWN_MS)
}

/**
 * Acquire an account from the pool, run `fn`, and on failure retry against
 * a different account up to `min(pool size, MAX_RETRIES_CAP)` times.
 *
 * Retry policy:
 *   - 4xx (non-401): no retry; client error rethrows immediately.
 *   - 401:           refresh the account's Copilot token and retry.
 *   - 5xx / network: cooldown the account for 30s and retry.
 *
 * Streaming handlers should call `withAccount` ONLY around the upstream
 * fetch — once SSE has started flushing, retry is unsafe.
 */
export async function withAccount<T>(
  c: Context | undefined,
  fn: (account: Account) => Promise<T>,
  options: WithAccountOptions = {},
): Promise<T> {
  if (!state.pool) throw new Error("Account pool not initialized")
  const pool = state.pool
  void c // currently unused; kept for parity with design (e.g. internal-call header)

  const usableCount = pool.accounts.length
  const requested = options.maxRetries ?? MAX_RETRIES_CAP
  const maxAttempts = Math.max(
    1,
    Math.min(requested, usableCount, MAX_RETRIES_CAP),
  )

  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const account = pool.acquire()
    try {
      const out = await fn(account)
      account.failureCount = 0
      pool.release(account)
      return out
    } catch (err) {
      lastErr = err
      pool.release(account)
      pool.markFailure(account)
      await handleAttemptError(pool, account, err)
    }
  }
  throw lastErr
}
