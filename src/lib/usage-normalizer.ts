/**
 * Pure (no DB, no network, no global state) helpers that convert upstream
 * usage payloads from OpenAI and Anthropic into a single shape the rest of
 * the system stores.
 *
 * Field rules (see docs/design/02-database-schema.md):
 *   - Anthropic `cache_creation_input_tokens` is folded into `inputTokens`.
 *   - OpenAI `completion_tokens` already includes reasoning tokens — never
 *     add them on top of `outputTokens`. `reasoningTokens` is informational.
 */

export interface NormalizedUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}

export class UsageMissingError extends Error {
  constructor(message = "Upstream stream never delivered usage information") {
    super(message)
    this.name = "UsageMissingError"
  }
}

interface OpenAIUsageShape {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

interface AnthropicUsageShape {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface AnthropicMessageShape {
  type?: string
  message?: { usage?: AnthropicUsageShape }
  usage?: AnthropicUsageShape
}

const numOr0 = (v: unknown): number => (typeof v === "number" ? v : 0)

export function normalizeOpenAIFinal(usage: unknown): NormalizedUsage {
  const u = (usage ?? {}) as OpenAIUsageShape
  const inputTokens = numOr0(u.prompt_tokens)
  const cachedInputTokens = numOr0(u.prompt_tokens_details?.cached_tokens)
  const outputTokens = numOr0(u.completion_tokens)
  const reasoningTokens = numOr0(u.completion_tokens_details?.reasoning_tokens)
  const totalTokens = numOr0(u.total_tokens) || inputTokens + outputTokens
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  }
}

export function normalizeAnthropicMessage(message: unknown): NormalizedUsage {
  const m = (message ?? {}) as { usage?: AnthropicUsageShape }
  const u = m.usage ?? {}
  const baseInput = numOr0(u.input_tokens)
  const cacheCreate = numOr0(u.cache_creation_input_tokens)
  const cachedInputTokens = numOr0(u.cache_read_input_tokens)
  const inputTokens = baseInput + cacheCreate
  const outputTokens = numOr0(u.output_tokens)
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens: 0,
    totalTokens: inputTokens + outputTokens,
  }
}

export function normalizeEmbeddings(usage: unknown): NormalizedUsage {
  const u = (usage ?? {}) as { prompt_tokens?: number; total_tokens?: number }
  const inputTokens = numOr0(u.prompt_tokens)
  return {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: numOr0(u.total_tokens) || inputTokens,
  }
}

export interface StreamUsageAccumulator {
  feed(chunk: unknown): void
  finalize(): NormalizedUsage
}

interface ResponsesUsageShape {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
}

export function normalizeResponsesFinal(usage: unknown): NormalizedUsage {
  const u = (usage ?? {}) as ResponsesUsageShape
  const inputTokens = numOr0(u.input_tokens)
  const cachedInputTokens = numOr0(u.input_tokens_details?.cached_tokens)
  const outputTokens = numOr0(u.output_tokens)
  const reasoningTokens = numOr0(u.output_tokens_details?.reasoning_tokens)
  const totalTokens = numOr0(u.total_tokens) || inputTokens + outputTokens
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  }
}

export function createResponsesAccumulator(): StreamUsageAccumulator {
  let saved: ResponsesUsageShape | undefined
  return {
    feed(chunk) {
      const c = chunk as
        | { type?: string; response?: { usage?: ResponsesUsageShape } }
        | null
        | undefined
      if (!c) return
      if (c.type === "response.completed" && c.response?.usage) {
        saved = c.response.usage
      }
    },
    finalize() {
      if (!saved) throw new UsageMissingError()
      return normalizeResponsesFinal(saved)
    },
  }
}

export function createOpenAIAccumulator(): StreamUsageAccumulator {
  let saved: OpenAIUsageShape | undefined

  return {
    feed(chunk) {
      const c = chunk as { usage?: OpenAIUsageShape } | null | undefined
      if (c && c.usage) {
        saved = c.usage
      }
    },
    finalize() {
      if (!saved) throw new UsageMissingError()
      return normalizeOpenAIFinal(saved)
    },
  }
}

export function createAnthropicAccumulator(): StreamUsageAccumulator {
  let inputTokens = 0
  let cachedInputTokens = 0
  let outputTokens = 0

  return {
    feed(chunk) {
      const ev = (chunk ?? {}) as AnthropicMessageShape
      if (ev.type === "message_start" && ev.message?.usage) {
        const u = ev.message.usage
        inputTokens =
          numOr0(u.input_tokens) + numOr0(u.cache_creation_input_tokens)
        cachedInputTokens = numOr0(u.cache_read_input_tokens)
        outputTokens = numOr0(u.output_tokens)
        return
      }
      if (ev.type === "message_delta" && ev.usage) {
        outputTokens = Math.max(outputTokens, numOr0(ev.usage.output_tokens))
      }
    },
    finalize() {
      return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens: 0,
        totalTokens: inputTokens + outputTokens,
      }
    },
  }
}
