import consola from "consola"
import fs from "node:fs/promises"
import path from "node:path"

import { detectAccountInfo } from "~/services/github/detect-account-info"

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
 * Parse a single `--github-token` segment.
 *
 * - 1 segment  → pure token, name=`account-{index}`, type auto-detected later
 * - 2+ segments → `name:token` (token may contain `:`)
 */
export function parseGithubTokenArg(
  raw: string,
  index: number,
): AccountsFileEntry {
  const idx = raw.indexOf(":")
  if (idx === -1) {
    return {
      name: `account-${index + 1}`,
      github_token: raw,
    }
  }
  return {
    name: raw.slice(0, idx),
    github_token: raw.slice(idx + 1),
  }
}

/**
 * Parse a comma-separated `--github-token` value into multiple account entries.
 */
export function parseGithubTokenArgs(raw: string): Array<AccountsFileEntry> {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s, i) => parseGithubTokenArg(s, i))
}

/**
 * Auto-detect account type and username for entries missing them.
 * Mutates entries in-place. Runs detections in parallel.
 */
async function enrichWithDetection(
  entries: Array<AccountsFileEntry>,
): Promise<void> {
  const results = await Promise.all(
    entries.map((e) => detectAccountInfo(e.github_token)),
  )
  for (const [i, entry] of entries.entries()) {
    const info = results[i]

    // Auto-fill account type
    if (!entry.account_type) {
      entry.account_type = info.accountType
    }

    // Replace auto-generated name with GitHub username
    if (entry.name.startsWith("account-")) {
      entry.name = info.login
    }

    consola.info(`[${entry.name}] detected as ${entry.account_type} account`)
  }

  // Deduplicate names by appending suffix
  const seen = new Map<string, number>()
  for (const entry of entries) {
    const count = seen.get(entry.name) ?? 0
    if (count > 0) {
      entry.name = `${entry.name}-${count + 1}`
    }
    seen.set(entry.name, count + 1)
  }
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
    // Auto-detect account type and username for CLI tokens
    await enrichWithDetection(options.legacyTokens)
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
