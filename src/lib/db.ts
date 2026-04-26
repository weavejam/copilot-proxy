import fs from "node:fs"
import path from "node:path"

import migration001 from "./migrations/001_initial.sql" with { type: "text" }
import { createDatabase, type DbInstance } from "./sqlite-adapter"

export const CURRENT_SCHEMA_VERSION = 1

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: migration001 },
]

let dbInstance: DbInstance | undefined

export function initDb(dbPath: string): DbInstance {
  if (dbInstance) return dbInstance

  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }

  const db = createDatabase(dbPath)

  // Pragmas — set before any schema work.
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("foreign_keys = ON")

  runMigrations(db)

  dbInstance = db
  return db
}

export function getDb(): DbInstance {
  if (!dbInstance) {
    throw new Error(
      "Database not initialized. Call initDb(path) before getDb().",
    )
  }
  return dbInstance
}

export function withTransaction<T>(fn: (db: DbInstance) => T): T {
  const db = getDb()
  const tx = db.transaction((arg: () => T) => arg())
  return tx(() => fn(db))
}

/**
 * Test-only helper. Closes any current instance and clears the singleton so
 * the next initDb call starts from scratch. Production code must never call
 * this — it exists to keep tests isolated.
 */
export function __resetDbForTests(): void {
  if (dbInstance) {
    try {
      dbInstance.close()
    } catch {
      // ignore
    }
    dbInstance = undefined
  }
}

function runMigrations(db: DbInstance): void {
  // Bootstrap meta table so we can read schema_version.
  db.exec(
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  )

  const row = db
    .prepare("SELECT value FROM meta WHERE key='schema_version'")
    .get() as { value: string } | undefined
  const currentVersion = row ? Number.parseInt(row.value, 10) : 0

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  )

  if (pending.length === 0) return

  const apply = db.transaction(() => {
    for (const m of pending) {
      db.exec(m.sql)
    }
    db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) "
        + "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run("schema_version", String(CURRENT_SCHEMA_VERSION))
  })
  apply()
}

export { type DbInstance } from "./sqlite-adapter"
