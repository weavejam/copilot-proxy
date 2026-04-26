import consola from "consola"
import fs from "node:fs/promises"
import path from "node:path"

import type { Account } from "./account-pool"

import { getDb } from "./db"
import { PATHS } from "./paths"

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
  legacyTokens?: Array<AccountsFileEntry>
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

/**
 * Parse a single `--github-token` segment with format `name:type:token`.
 *
 * - 1 segment  → pure token, name=`account-{index}`, type=defaultType
 * - 2 segments → `name:token`, type=defaultType
 * - 3+ segments → `name:type:token` (token may contain `:`)
 */
export function parseGithubTokenArg(
  raw: string,
  index: number,
  defaultType: string,
): AccountsFileEntry {
  const parts = raw.split(":")
  if (parts.length === 1) {
    return {
      name: `account-${index + 1}`,
      github_token: parts[0],
      account_type: defaultType,
    }
  }
  if (parts.length === 2) {
    return {
      name: parts[0],
      github_token: parts[1],
      account_type: defaultType,
    }
  }
  // 3+ segments: name:type:token (token may contain colons)
  return {
    name: parts[0],
    account_type: parts[1],
    github_token: parts.slice(2).join(":"),
  }
}

/**
 * Parse a comma-separated `--github-token` value into multiple account entries.
 */
export function parseGithubTokenArgs(
  raw: string,
  defaultType: string,
): Array<AccountsFileEntry> {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s, i) => parseGithubTokenArg(s, i, defaultType))
}

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
  } else if (options.legacyTokens && options.legacyTokens.length > 0) {
    for (const entry of options.legacyTokens) {
      accounts.push({
        name: entry.name,
        accountType: entry.account_type ?? options.defaultAccountType,
        githubToken: entry.github_token,
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

/** Read accounts file, returning empty accounts array if missing/invalid. */
export async function readAccountsFile(
  filePath?: string,
): Promise<AccountsFile> {
  const p = filePath ?? PATHS.ACCOUNTS_FILE_PATH
  try {
    const buf = await fs.readFile(p)
    const parsed = JSON.parse(buf.toString("utf8")) as AccountsFile
    if (Array.isArray(parsed.accounts)) return parsed
  } catch {
    // File missing or invalid — return empty
  }
  return { accounts: [] }
}

/** Write accounts file with restricted permissions. */
export async function writeAccountsFile(
  data: AccountsFile,
  filePath?: string,
): Promise<void> {
  const p = filePath ?? PATHS.ACCOUNTS_FILE_PATH
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8")
  try {
    await fs.chmod(p, 0o600)
  } catch {
    // chmod may fail on Windows — non-critical
  }
}

/** Append an account entry. Throws if name already exists. */
export async function addAccountEntry(
  entry: AccountsFileEntry,
  filePath?: string,
): Promise<void> {
  const data = await readAccountsFile(filePath)
  if (data.accounts.some((a) => a.name === entry.name)) {
    throw new Error(`Account "${entry.name}" already exists`)
  }
  data.accounts.push(entry)
  await writeAccountsFile(data, filePath)
  consola.success(`Account "${entry.name}" added`)
}

/** Remove an account by name. Returns true if found and removed. */
export async function removeAccountEntry(
  name: string,
  filePath?: string,
): Promise<boolean> {
  const data = await readAccountsFile(filePath)
  const idx = data.accounts.findIndex((a) => a.name === name)
  if (idx === -1) return false
  data.accounts.splice(idx, 1)
  await writeAccountsFile(data, filePath)
  consola.success(`Account "${name}" removed`)
  return true
}
