import { test, expect, mock } from "bun:test"

import type { Account } from "../src/lib/account-pool"
import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { createChatCompletions } from "../src/services/copilot/create-chat-completions"

const account: Account = {
  name: "test",
  accountType: "individual",
  githubToken: "ghu_test",
  copilotToken: "test-token",
  copilotTokenRefreshAt: 0,
  inFlight: 0,
  lastUsedAt: 0,
  failureCount: 0,
}
const ctx = { account, vsCodeVersion: "1.0.0" }

const fetchMock = mock(
  (_url: string, opts: { headers: Record<string, string> }) => {
    return {
      ok: true,
      json: () => ({ id: "123", object: "chat.completion", choices: [] }),
      headers: opts.headers,
    }
  },
)
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

test("sets X-Initiator to agent if tool/assistant present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(ctx, payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("agent")
})

test("sets X-Initiator to user if only user present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(ctx, payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[1][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("user")
})
