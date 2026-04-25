# Task 01 — DB module + migrations + meta

**Depends on:** —
**Unblocks:** 02, 06

## Goal

Set up `bun:sqlite` with a versioned migration system so every later step can
just call `getDb()` and run prepared statements.

## Scope

- New file `src/lib/db.ts`.
- Schema for `accounts`, `usage_events`, `usage_daily`,
  `model_pricing`, `model_pricing_versions`, `pricing_sync_log`, `meta`.
- Migration runner driven by `meta.schema_version` (start at `1`).
- WAL mode, `synchronous = NORMAL`.
- DB path resolved from `--db-path` flag (default
  `~/.local/share/copilot-api/usage.sqlite`); add the flag to `start.ts`
  argument parser.
- `ensurePaths()` (in `src/lib/paths.ts`) gains the DB directory.

## Non-goals

- Any actual writes from feature code (later tasks own that).
- Pricing data seeding.

## API surface

```ts
export function initDb(path: string): Database
export function getDb(): Database
export function withTransaction<T>(fn: (db: Database) => T): T
```

Migrations live in `src/lib/migrations/001_initial.sql` and are applied
in order based on filename.

## Definition of Done

- [ ] `bun run dev` starts and creates a fresh DB with all tables.
- [ ] Re-running `bun run dev` does NOT re-apply migrations.
- [ ] Unit test: open in-memory DB, run migrations, verify
  `meta.schema_version = 1` and that all tables exist.
- [ ] `--db-path` works with a custom path.
