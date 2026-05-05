import type { Context } from "hono"

import consola from "consola"

import type { Account } from "~/lib/account-pool"
import type { ApiContext } from "~/lib/api-config"
import type { Model } from "~/services/copilot/get-models"

import { getModels } from "~/services/copilot/get-models"
import { getVSCodeVersion } from "~/services/get-vscode-version"

import { state } from "./state"

export const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined

export function normalizeClaudeModelVersion(model: string): string {
  if (!model.startsWith("claude-")) {
    return model
  }

  // Convert numeric segments from hyphen to dot, e.g. claude-opus-4-6 -> claude-opus-4.6.
  // Only replace when the next numeric token ends at '-' or end, so suffixes like '-1m' stay unchanged.
  return model.replaceAll(/(\d)-(?=\d(?:-|$))/g, "$1.")
}

/**
 * Resolve model ID by checking the anthropic-beta header for context window variants.
 */
export function resolveModelId(model: string, c?: Context): string {
  const normalized = normalizeClaudeModelVersion(model)

  if (!c) {
    return normalized
  }

  const betaHeader = c.req.header("anthropic-beta")
  if (
    normalized.startsWith("claude-")
    && betaHeader
    && /\bcontext-1m\b/.test(betaHeader)
  ) {
    if (normalized.endsWith("-1m")) {
      return normalized
    }
    return `${normalized}-1m`
  }

  return normalized
}

/**
 * Calculate Jaccard similarity between two strings based on character bigrams.
 */
function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>()
  const normalized = str.toLowerCase().replaceAll(/[^a-z0-9]/g, "")
  for (let i = 0; i < normalized.length - 1; i++) {
    bigrams.add(normalized.slice(i, i + 2))
  }
  return bigrams
}

export function jaccardSimilarity(str1: string, str2: string): number {
  const bigrams1 = getBigrams(str1)
  const bigrams2 = getBigrams(str2)

  if (bigrams1.size === 0 && bigrams2.size === 0) {
    return 1
  }

  let intersection = 0
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) {
      intersection++
    }
  }

  const union = bigrams1.size + bigrams2.size - intersection
  return union === 0 ? 0 : intersection / union
}

function findBestModelMatch(
  modelId: string,
  models: Array<Model>,
  minSimilarity = 0.3,
): Model | null {
  if (models.length === 0) {
    return null
  }

  let bestMatch: Model | null = null
  let bestScore = 0

  for (const model of models) {
    const score = jaccardSimilarity(modelId, model.id)
    if (score > bestScore) {
      bestScore = score
      bestMatch = model
    }
  }

  if (bestScore >= minSimilarity && bestMatch) {
    consola.info(
      `Fuzzy matched model "${modelId}" to "${bestMatch.id}" (similarity: ${bestScore.toFixed(2)})`,
    )
    return bestMatch
  }

  return null
}

/**
 * Resolve a requested model ID against available Copilot models.
 * Order: exact -> fuzzy -> auto-version fallback -> first available.
 */
export function mapModelIdToAvailableModels(
  requestedModelId: string,
  models: Array<Model>,
): string {
  if (models.length === 0) {
    return requestedModelId
  }

  const exact = models.find((m) => m.id === requestedModelId)
  if (exact) {
    return exact.id
  }

  const fuzzy = findBestModelMatch(requestedModelId, models)
  if (fuzzy) {
    return fuzzy.id
  }

  const autoModel = models.find((m) => m.id === "auto")
  const autoVersionModel = models.find((m) => m.version === autoModel?.version)
  if (autoVersionModel) {
    consola.info(
      `Model "${requestedModelId}" not found, using ${autoVersionModel.id} model`,
    )
    return autoVersionModel.id
  }

  const fallback = models[0]
  consola.info(
    `Model "${requestedModelId}" not found, using first available model: ${fallback.id}`,
  )
  return fallback.id
}

/**
 * Resolve model ID from request metadata, then map to an available server model.
 */
export function resolveAndMapModelId(
  model: string,
  c?: Context,
  models: Array<Model> = state.models?.data ?? [],
): string {
  const resolved = resolveModelId(model, c)
  return mapModelIdToAvailableModels(resolved, models)
}

export function makeApiContext(account: Account): ApiContext {
  return { account, vsCodeVersion: state.vsCodeVersion }
}

/** Returns an ApiContext for the first available pool account. */
export function defaultApiContext(): ApiContext {
  if (!state.pool || state.pool.accounts.length === 0) {
    throw new Error("Account pool is empty; cannot build ApiContext")
  }
  return makeApiContext(state.pool.accounts[0])
}

export async function cacheModels(): Promise<void> {
  const models = await getModels(defaultApiContext())
  state.models = models
}

export const cacheVSCodeVersion = async () => {
  const response = await getVSCodeVersion()
  state.vsCodeVersion = response

  consola.info(`Using VSCode version: ${response}`)
}
