import { test, expect, describe, beforeEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  loadAccounts,
  persistAccounts,
  readAccountsFile,
  writeAccountsFile,
  addAccountEntry,
  removeAccountEntry,
} from "../src/lib/accounts-loader"
import { initDb, __resetDbForTests } from "../src/lib/db"

const tmp = (suffix = "") =>
  path.join(
    os.tmpdir(),
    `copilot-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
  )

describe("accounts-loader", () => {
  beforeEach(() => {
    __resetDbForTests()
  })

  test("loads from accounts.json", async () => {
    const file = tmp(".json")
    fs.writeFileSync(
      file,
      JSON.stringify({
        accounts: [
          { name: "alice", github_token: "ghu_a", account_type: "business" },
          { name: "bob", github_token: "ghu_b" },
        ],
      }),
    )
    const accounts = await loadAccounts({
      accountsFile: file,
      defaultAccountType: "individual",
    })
    expect(accounts).toHaveLength(2)
    expect(accounts[0]).toMatchObject({
      name: "alice",
      accountType: "business",
    })
    expect(accounts[1]).toMatchObject({
      name: "bob",
      accountType: "individual",
    })
    fs.unlinkSync(file)
  })

  test("falls back to legacy single token when no file", async () => {
    const accounts = await loadAccounts({
      legacyToken: "ghu_legacy",
      defaultAccountType: "individual",
    })
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({
      name: "default",
      githubToken: "ghu_legacy",
      accountType: "individual",
    })
  })

  test("returns empty array if neither file nor token provided", async () => {
    const accounts = await loadAccounts({ defaultAccountType: "individual" })
    expect(accounts).toEqual([])
  })

  test("persistAccounts inserts into accounts table and is idempotent", async () => {
    const dbPath = tmp(".sqlite")
    const db = initDb(dbPath)
    const accounts = await loadAccounts({
      legacyToken: "ghu_legacy",
      defaultAccountType: "individual",
    })
    persistAccounts(accounts)
    persistAccounts(accounts) // again — should not error or duplicate
    const rows = db
      .prepare("SELECT name, account_type FROM accounts")
      .all() as Array<{ name: string; account_type: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("default")
    db.close()
    try {
      fs.unlinkSync(dbPath)
    } catch {
      // Windows may keep WAL/SHM file locks briefly; ignore.
    }
  })
})

describe("account file helpers", () => {
  test("readAccountsFile returns empty for missing file", async () => {
    const data = await readAccountsFile(tmp(".json"))
    expect(data).toEqual({ accounts: [] })
  })

  test("writeAccountsFile + readAccountsFile round-trip", async () => {
    const file = tmp(".json")
    const payload = {
      accounts: [
        { name: "a", github_token: "ghu_x", account_type: "individual" },
      ],
    }
    await writeAccountsFile(payload, file)
    const read = await readAccountsFile(file)
    expect(read.accounts).toHaveLength(1)
    expect(read.accounts[0].name).toBe("a")
    fs.unlinkSync(file)
  })

  test("addAccountEntry appends to file", async () => {
    const file = tmp(".json")
    await writeAccountsFile({ accounts: [] }, file)
    await addAccountEntry(
      { name: "alice", github_token: "ghu_a", account_type: "individual" },
      file,
    )
    await addAccountEntry(
      { name: "bob", github_token: "ghu_b", account_type: "business" },
      file,
    )
    const data = await readAccountsFile(file)
    expect(data.accounts).toHaveLength(2)
    expect(data.accounts.map((a) => a.name)).toEqual(["alice", "bob"])
    fs.unlinkSync(file)
  })

  test("addAccountEntry throws on duplicate name", async () => {
    const file = tmp(".json")
    await writeAccountsFile(
      { accounts: [{ name: "alice", github_token: "ghu_a" }] },
      file,
    )
    let caught: Error | undefined
    try {
      await addAccountEntry({ name: "alice", github_token: "ghu_b" }, file)
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.message).toBe('Account "alice" already exists')
    fs.unlinkSync(file)
  })

  test("removeAccountEntry removes by name", async () => {
    const file = tmp(".json")
    await writeAccountsFile(
      {
        accounts: [
          { name: "alice", github_token: "ghu_a" },
          { name: "bob", github_token: "ghu_b" },
        ],
      },
      file,
    )
    const removed = await removeAccountEntry("alice", file)
    expect(removed).toBe(true)
    const data = await readAccountsFile(file)
    expect(data.accounts).toHaveLength(1)
    expect(data.accounts[0].name).toBe("bob")
    fs.unlinkSync(file)
  })

  test("removeAccountEntry returns false for unknown name", async () => {
    const file = tmp(".json")
    await writeAccountsFile({ accounts: [] }, file)
    const removed = await removeAccountEntry("ghost", file)
    expect(removed).toBe(false)
    fs.unlinkSync(file)
  })

  test("addAccountEntry creates file if missing", async () => {
    const file = tmp(".json")
    await addAccountEntry({ name: "new", github_token: "ghu_new" }, file)
    const data = await readAccountsFile(file)
    expect(data.accounts).toHaveLength(1)
    expect(data.accounts[0].name).toBe("new")
    fs.unlinkSync(file)
  })
})
