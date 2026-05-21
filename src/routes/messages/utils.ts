import { type AnthropicResponse } from "./anthropic-types"

export function mapOpenAIStopReasonToAnthropic(
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null,
): AnthropicResponse["stop_reason"] {
  if (finishReason === null) {
    return null
  }
  const stopReasonMap = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    content_filter: "end_turn",
  } as const
  return stopReasonMap[finishReason]
}

interface OpenAIUsageLike {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number
    cache_creation_input_tokens?: number
  }
}

export function toAnthropicUsage(
  usage: OpenAIUsageLike | undefined,
  { includeOutput }: { includeOutput: boolean },
): AnthropicResponse["usage"] {
  const prompt = usage?.prompt_tokens ?? 0
  const cacheRead = usage?.prompt_tokens_details?.cached_tokens
  const cacheCreate = usage?.prompt_tokens_details?.cache_creation_input_tokens

  return {
    input_tokens: prompt - (cacheRead ?? 0) - (cacheCreate ?? 0),
    output_tokens: includeOutput ? (usage?.completion_tokens ?? 0) : 0,
    ...(cacheRead !== undefined && { cache_read_input_tokens: cacheRead }),
    ...(cacheCreate !== undefined && {
      cache_creation_input_tokens: cacheCreate,
    }),
  }
}
