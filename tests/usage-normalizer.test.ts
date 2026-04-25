import { test, expect, describe } from "bun:test"

import {
  createAnthropicAccumulator,
  createOpenAIAccumulator,
  normalizeAnthropicMessage,
  normalizeEmbeddings,
  normalizeOpenAIFinal,
  UsageMissingError,
} from "../src/lib/usage-normalizer"

describe("normalizeOpenAIFinal", () => {
  test("maps prompt/completion/total + cached + reasoning", () => {
    const out = normalizeOpenAIFinal({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 20 },
      completion_tokens_details: { reasoning_tokens: 10 },
    })
    expect(out).toEqual({
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 50,
      reasoningTokens: 10,
      totalTokens: 150,
    })
  })

  test("missing fields default to 0", () => {
    const out = normalizeOpenAIFinal({
      prompt_tokens: 10,
      completion_tokens: 5,
    })
    expect(out.inputTokens).toBe(10)
    expect(out.outputTokens).toBe(5)
    expect(out.cachedInputTokens).toBe(0)
    expect(out.reasoningTokens).toBe(0)
    expect(out.totalTokens).toBe(15)
  })
})

describe("normalizeAnthropicMessage", () => {
  test("folds cache_creation_input_tokens into inputTokens", () => {
    const out = normalizeAnthropicMessage({
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 25,
        cache_read_input_tokens: 75,
        output_tokens: 30,
      },
    })
    expect(out.inputTokens).toBe(125)
    expect(out.cachedInputTokens).toBe(75)
    expect(out.outputTokens).toBe(30)
    expect(out.totalTokens).toBe(155)
  })
})

describe("normalizeEmbeddings", () => {
  test("uses prompt_tokens as input", () => {
    const out = normalizeEmbeddings({ prompt_tokens: 12, total_tokens: 12 })
    expect(out.inputTokens).toBe(12)
    expect(out.outputTokens).toBe(0)
    expect(out.totalTokens).toBe(12)
  })
})

describe("createOpenAIAccumulator", () => {
  test("captures usage from final chunk", () => {
    const acc = createOpenAIAccumulator()
    acc.feed({ choices: [{ delta: { content: "hi" } }] })
    acc.feed({
      choices: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    })
    const out = acc.finalize()
    expect(out.inputTokens).toBe(10)
    expect(out.outputTokens).toBe(5)
  })

  test("throws when usage chunk never arrives", () => {
    const acc = createOpenAIAccumulator()
    acc.feed({ choices: [{ delta: { content: "hi" } }] })
    expect(() => acc.finalize()).toThrow(UsageMissingError)
  })
})

describe("createAnthropicAccumulator", () => {
  test("aggregates message_start + message_delta", () => {
    const acc = createAnthropicAccumulator()
    acc.feed({
      type: "message_start",
      message: {
        usage: {
          input_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20,
          output_tokens: 1,
        },
      },
    })
    acc.feed({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "a" },
    })
    acc.feed({ type: "message_delta", usage: { output_tokens: 7 } })
    acc.feed({ type: "message_delta", usage: { output_tokens: 12 } })
    const out = acc.finalize()
    expect(out.inputTokens).toBe(60)
    expect(out.cachedInputTokens).toBe(20)
    expect(out.outputTokens).toBe(12)
    expect(out.totalTokens).toBe(72)
  })

  test("returns sane zeros if only message_start arrived", () => {
    const acc = createAnthropicAccumulator()
    acc.feed({
      type: "message_start",
      message: { usage: { input_tokens: 5, output_tokens: 1 } },
    })
    const out = acc.finalize()
    expect(out.inputTokens).toBe(5)
    expect(out.outputTokens).toBe(1)
  })

  test("returns zeros when nothing arrives", () => {
    const acc = createAnthropicAccumulator()
    const out = acc.finalize()
    expect(out).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    })
  })
})
