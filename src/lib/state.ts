import type { ModelsResponse } from "~/services/copilot/get-models"

import type { Account, AccountPool, Strategy } from "./account-pool"

export type CopilotUpstreamEndpoint = "chat" | "responses"

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

  /**
   * Per-model memory of which Copilot upstream endpoint last succeeded.
   * Some models (gpt-5*) only work on /responses; others only on
   * /chat/completions. Once a model is observed to succeed on one endpoint,
   * we keep using that endpoint for the rest of the process lifetime so
   * we don't pay an extra failed round trip on every call.
   */
  modelEndpointRoute: Map<string, CopilotUpstreamEndpoint>
}

export const state: State = {
  accountType: "individual",
  strategy: "round-robin",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
  modelEndpointRoute: new Map(),
}

/** Convenience: the first usable account. */
export function defaultAccount(): Account | undefined {
  return state.pool?.accounts[0]
}
