export interface Account {
  name: string
  accountType: string
  githubToken: string
  copilotToken?: string
  copilotTokenRefreshAt: number
  inFlight: number
  lastUsedAt: number
  cooldownUntil?: number
  failureCount: number
  refreshTimer?: ReturnType<typeof setInterval>
}

export type Strategy = "round-robin" | "least-busy" | "least-recent"

export class AccountPool {
  private cursor = 0
  public readonly accounts: Array<Account>
  public strategy: Strategy

  constructor(accounts: Array<Account>, strategy: Strategy) {
    this.accounts = accounts
    this.strategy = strategy
  }

  /** Returns usable accounts: have copilot token AND not on cooldown. */
  private usable(): Array<Account> {
    const now = Date.now()
    return this.accounts.filter(
      (a) => a.copilotToken && (a.cooldownUntil ?? 0) <= now,
    )
  }

  pick(): Account {
    const candidates = this.usable()
    if (candidates.length === 0) {
      throw new Error(
        "No usable Copilot accounts (all on cooldown or unauthenticated)",
      )
    }
    // eslint-disable-next-line default-case
    switch (this.strategy) {
      case "round-robin": {
        const a = candidates[this.cursor % candidates.length]
        this.cursor = (this.cursor + 1) % Math.max(candidates.length, 1)
        return a
      }
      case "least-busy": {
        return candidates.reduce((best, cur) => {
          if (cur.inFlight !== best.inFlight)
            return cur.inFlight < best.inFlight ? cur : best
          return cur.lastUsedAt < best.lastUsedAt ? cur : best
        })
      }
      case "least-recent": {
        return candidates.reduce((best, cur) =>
          cur.lastUsedAt < best.lastUsedAt ? cur : best,
        )
      }
      // No default — Strategy union is exhaustively handled.
    }
  }

  acquire(): Account {
    const a = this.pick()
    a.inFlight += 1
    return a
  }

  release(a: Account): void {
    a.inFlight = Math.max(0, a.inFlight - 1)
    a.lastUsedAt = Date.now()
  }

  markCooldown(a: Account, ms: number): void {
    a.cooldownUntil = Date.now() + ms
  }

  markFailure(a: Account): void {
    a.failureCount += 1
  }

  byName(name: string): Account | undefined {
    return this.accounts.find((a) => a.name === name)
  }
}
