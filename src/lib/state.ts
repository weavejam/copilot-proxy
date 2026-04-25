import type { ModelsResponse } from "~/services/copilot/get-models"

import type { Account, AccountPool, Strategy } from "./account-pool"

export interface State {
  pool?: AccountPool
  strategy: Strategy

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

/** Convenience: the first usable account. */
export function defaultAccount(): Account | undefined {
  return state.pool?.accounts[0]
}
