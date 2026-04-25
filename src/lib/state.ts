import type { ModelsResponse } from "~/services/copilot/get-models"

import type { Account, Strategy } from "./account-pool"
import type { AccountPool } from "./account-pool"

export interface State {
  // Multi-account pool. Until task 03 wires service code through it,
  // legacy fields below mirror the "default" account.
  pool?: AccountPool
  strategy: Strategy

  // Legacy fields (deprecated; will be removed in task 03):
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  manualApprove: boolean
  rateLimitWait: boolean
  showToken: boolean

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number
}

export const state: State = {
  accountType: "individual",
  strategy: "round-robin",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
}

/** Convenience: the first usable account, used by legacy single-account paths. */
export function defaultAccount(): Account | undefined {
  return state.pool?.accounts[0]
}
