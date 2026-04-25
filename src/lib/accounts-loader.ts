import fs from "node:fs/promises"
import path from "node:path"

import type { Account } from "./account-pool"

import { getDb } from "./db"

export interface AccountsFileEntry {
  name: string
  github_token: string
  account_type?: string
}

export interface AccountsFile {
  accounts: Array<AccountsFileEntry>
}

export interface LoadAccountsOptions {
  accountsFile?: string
  legacyToken?: string
  defaultAccountType: string
}

const FRESH = (): Pick<
  Account,
  | "copilotToken"
  | "copilotTokenRefreshAt"
  | "inFlight"
  | "lastUsedAt"
  | "failureCount"
> => ({
  copilotToken: undefined,
  copilotTokenRefreshAt: 0,
  inFlight: 0,
  lastUsedAt: 0,
  failureCount: 0,
})

export async function loadAccounts(
  options: LoadAccountsOptions,
): Promise<Array<Account>> {
  const accounts: Array<Account> = []

  if (options.accountsFile) {
    const buf = await fs.readFile(path.resolve(options.accountsFile))
    const parsed = JSON.parse(buf.toString("utf8")) as AccountsFile
    for (const e of parsed.accounts) {
      accounts.push({
        name: e.name,
        accountType: e.account_type ?? options.defaultAccountType,
        githubToken: e.github_token,
        ...FRESH(),
      })
    }
  } else if (options.legacyToken && options.legacyToken.length > 0) {
    accounts.push({
      name: "default",
      accountType: options.defaultAccountType,
      githubToken: options.legacyToken,
      ...FRESH(),
    })
  }

  return accounts
}

/** Insert any new accounts into the `accounts` table (idempotent). */
export function persistAccounts(accounts: Array<Account>): void {
  const db = getDb()
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO accounts (name, account_type, created_at) VALUES (?, ?, ?)",
  )
  const now = Date.now()
  const tx = db.transaction((rows: Array<Account>) => {
    for (const a of rows) {
      stmt.run(a.name, a.accountType, now)
    }
  })
  tx(accounts)
}
