import { test, expect, describe, beforeEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { loadAccounts, persistAccounts } from "../src/lib/accounts-loader"
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
      .query<
        { name: string; account_type: string },
        []
      >("SELECT name, account_type FROM accounts")
      .all()
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
