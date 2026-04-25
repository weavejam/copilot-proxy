import consola from "consola"

import { getDb } from "./db"
import { runPricingSync } from "./pricing-sync-runner"

export interface SchedulePricingSyncOptions {
  port: number
  intervalDays: number
  syncModel?: string
}

function readLastSync(): number {
  try {
    const row = getDb()
      .query<
        { value: string },
        []
      >("SELECT value FROM meta WHERE key = 'last_pricing_sync_ts'")
      .get()
    if (!row) return 0
    return Number.parseInt(row.value, 10) || 0
  } catch {
    return 0
  }
}

/**
 * Background scheduler: runs pricing sync at startup if the last run is older
 * than the interval (or has never happened), and then every `intervalDays`.
 *
 * Errors never crash the process.
 */
export function schedulePricingSync(options: SchedulePricingSyncOptions): void {
  const intervalMs = options.intervalDays * 86_400_000

  const tick = () => {
    const last = readLastSync()
    const delay = Math.max(0, last + intervalMs - Date.now())
    setTimeout(() => {
      runPricingSync({
        port: options.port,
        syncModel: options.syncModel,
      })
        .then(
          (result) => {
            consola.info(
              `Pricing sync ${result.status} (updated=${result.updated}, rejected=${result.rejected})`,
            )
          },
          (err: unknown) => {
            consola.warn("Pricing sync failed:", err)
          },
        )
        .finally(() => {
          tick()
        })
    }, delay)
  }

  tick()
}
