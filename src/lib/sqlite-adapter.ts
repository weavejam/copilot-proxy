/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-require-imports, unicorn/prefer-module */
/**
 * Runtime-adaptive SQLite adapter.
 *
 * Uses `bun:sqlite` when running under Bun, `better-sqlite3` otherwise (Node.js).
 * Exposes a unified interface that matches the subset we actually use.
 */

export interface DbStatement {
  run(...params: Array<unknown>): { lastInsertRowid: number | bigint }
  get(...params: Array<unknown>): unknown
  all(...params: Array<unknown>): Array<unknown>
}

export interface DbInstance {
  prepare(sql: string): DbStatement
  exec(sql: string): void
  pragma(pragma: string): unknown
  transaction<F extends (...args: Array<never>) => unknown>(fn: F): F
  close(): void
}

const isBun = typeof globalThis.Bun !== "undefined"

export function createDatabase(dbPath: string): DbInstance {
  if (isBun) {
    return createBunDatabase(dbPath)
  }
  return createBetterSqlite3Database(dbPath)
}

function createBunDatabase(dbPath: string): DbInstance {
  // Dynamic import to avoid bundler resolving it on Node
  const { Database } = require("bun:sqlite")
  const db = new Database(dbPath, { create: true })

  return {
    prepare(sql: string): DbStatement {
      const stmt = db.query(sql)
      return {
        run(...params: Array<unknown>) {
          stmt.run(...params)
          // bun:sqlite doesn't return lastInsertRowid from run(),
          // but we can query it separately when needed
          const row = db.query("SELECT last_insert_rowid() AS id").get()
          return { lastInsertRowid: row?.id ?? 0 }
        },
        get(...params: Array<unknown>) {
          return stmt.get(...params) ?? undefined
        },
        all(...params: Array<unknown>) {
          return stmt.all(...params)
        },
      }
    },
    exec(sql: string) {
      db.exec(sql)
    },
    pragma(pragma: string) {
      // bun:sqlite uses db.query("PRAGMA ...").get() for read pragmas
      if (pragma.includes("=")) {
        db.run(`PRAGMA ${pragma}`)
        return undefined
      }
      return db.query(`PRAGMA ${pragma}`).get()
    },
    transaction<F extends (...args: Array<never>) => unknown>(fn: F): F {
      return db.transaction(fn)
    },
    close() {
      db.close()
    },
  }
}

function createBetterSqlite3Database(dbPath: string): DbInstance {
  const BetterSqlite3 = require("better-sqlite3")
  const db = new BetterSqlite3(dbPath)

  return {
    prepare(sql: string): DbStatement {
      const stmt = db.prepare(sql)
      return {
        run(...params: Array<unknown>) {
          return stmt.run(...params)
        },
        get(...params: Array<unknown>) {
          return stmt.get(...params) ?? undefined
        },
        all(...params: Array<unknown>) {
          return stmt.all(...params)
        },
      }
    },
    exec(sql: string) {
      db.exec(sql)
    },
    pragma(pragma: string) {
      return db.pragma(pragma)
    },
    transaction<F extends (...args: Array<never>) => unknown>(fn: F): F {
      return db.transaction(fn)
    },
    close() {
      db.close()
    },
  }
}
