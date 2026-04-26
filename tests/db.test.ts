import { test, expect, describe, beforeEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  initDb,
  getDb,
  withTransaction,
  CURRENT_SCHEMA_VERSION,
  __resetDbForTests,
} from "../src/lib/db"

const tmpDbPath = () =>
  path.join(
    os.tmpdir(),
    `copilot-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  )

describe("db module", () => {
  beforeEach(() => {
    __resetDbForTests()
  })

  test("initDb on a fresh path creates all tables and sets schema_version", () => {
    const p = tmpDbPath()
    const db = initDb(p)

    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name)

    for (const t of [
      "accounts",
      "model_pricing",
      "model_pricing_versions",
      "pricing_sync_log",
      "usage_daily",
      "usage_events",
      "meta",
    ]) {
      expect(tables).toContain(t)
    }

    const ver = db
      .prepare("SELECT value FROM meta WHERE key='schema_version'")
      .get() as { value: string } | undefined
    expect(ver?.value).toBe(String(CURRENT_SCHEMA_VERSION))

    db.close()
    fs.unlinkSync(p)
  })

  test("initDb is idempotent: running twice leaves schema_version unchanged and does not duplicate rows", () => {
    const p = tmpDbPath()
    const db1 = initDb(p)
    db1
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('marker', 'persisted') "
          + "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run()
    db1.close()

    __resetDbForTests()
    const db2 = initDb(p)
    const marker = db2
      .prepare("SELECT value FROM meta WHERE key='marker'")
      .get() as { value: string } | undefined
    expect(marker?.value).toBe("persisted")

    const ver = db2
      .prepare("SELECT value FROM meta WHERE key='schema_version'")
      .get() as { value: string } | undefined
    expect(ver?.value).toBe(String(CURRENT_SCHEMA_VERSION))

    db2.close()
    fs.unlinkSync(p)
  })

  test("getDb throws before initDb is called", () => {
    expect(() => getDb()).toThrow()
  })

  test("getDb returns the initialized instance", () => {
    const p = tmpDbPath()
    const db = initDb(p)
    expect(getDb()).toBe(db)
    db.close()
    fs.unlinkSync(p)
  })

  test("withTransaction commits on success", () => {
    const p = tmpDbPath()
    const db = initDb(p)

    withTransaction((d) => {
      d.prepare(
        "INSERT INTO accounts (name, account_type, created_at) "
          + "VALUES ('a', 'individual', 1)",
      ).run()
    })

    const row = db.prepare("SELECT name FROM accounts WHERE name='a'").get() as
      | { name: string }
      | undefined
    expect(row?.name).toBe("a")

    db.close()
    fs.unlinkSync(p)
  })

  test("withTransaction rolls back on throw", () => {
    const p = tmpDbPath()
    const db = initDb(p)

    expect(() =>
      withTransaction((d) => {
        d.prepare(
          "INSERT INTO accounts (name, account_type, created_at) "
            + "VALUES ('b', 'individual', 1)",
        ).run()
        throw new Error("boom")
      }),
    ).toThrow("boom")

    const row = db.prepare("SELECT name FROM accounts WHERE name='b'").get() as
      | { name: string }
      | undefined
    expect(row).toBeUndefined()

    db.close()
    fs.unlinkSync(p)
  })

  test("WAL mode is enabled", () => {
    const p = tmpDbPath()
    const db = initDb(p)
    const mode = db.pragma("journal_mode")
    // bun:sqlite returns { journal_mode: "wal" }, better-sqlite3 returns [{ journal_mode: "wal" }]
    let val: string
    if (Array.isArray(mode)) {
      val = (mode as Array<{ journal_mode: string }>)[0].journal_mode
    } else if (
      typeof mode === "object"
      && mode !== null
      && "journal_mode" in mode
    ) {
      val = (mode as { journal_mode: string }).journal_mode
    } else {
      val = String(mode)
    }
    expect(val.toLowerCase()).toBe("wal")
    db.close()
    fs.unlinkSync(p)
  })

  test("schema includes expected indexes", () => {
    const p = tmpDbPath()
    const db = initDb(p)
    const idxs = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name)
    expect(idxs).toContain("idx_usage_account_model_ts")
    expect(idxs).toContain("idx_usage_ts")
    expect(idxs).toContain("idx_pricing_versions_model_time")
    expect(idxs).toContain("idx_pricing_versions_current")
    db.close()
    fs.unlinkSync(p)
  })
})
