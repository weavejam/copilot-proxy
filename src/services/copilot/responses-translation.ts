/**
 * Translate between the OpenAI chat.completions wire format used internally by
 * this proxy and GitHub Copilot's `/responses` wire format.
 *
 * gpt-5* family models on GitHub Copilot are ONLY accessible through the
 * `/responses` endpoint — the same payload sent to `/chat/completions` returns
 * `unsupported_api_for_model`. To avoid touching every upstream handler we
 * translate the request on the way out and translate the response back into
 * `ChatCompletion` shape so the rest of the pipeline (Anthropic translation,
 * usage normalization, recording) doesn't need to know the difference.
 */

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
  ToolCall,
} from "./create-chat-completions"

// ---------- Outgoing payload translation ----------

interface ResponsesInputContentPart {
  type: "input_text" | "output_text" | "input_image"
  text?: string
  image_url?: string
}

interface ResponsesMessageItem {
  type: "message"
  role: "user" | "assistant" | "system" | "developer"
  content: Array<ResponsesInputContentPart>
}

interface ResponsesFunctionCallItem {
  type: "function_call"
  call_id: string
  name: string
  arguments: string
}

interface ResponsesFunctionCallOutputItem {
  type: "function_call_output"
  call_id: string
  output: string
}

type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem

export interface ResponsesPayload {
  model: string
  instructions?: string
  input: Array<ResponsesInputItem>
  tools?: Array<{
    type: "function"
    name: string
    description?: string
    parameters: Record<string, unknown>
  }>
  tool_choice?:
    | "auto"
    | "required"
    | "none"
    | { type: "function"; name: string }
  stream?: boolean | null
  temperature?: number | null
  top_p?: number | null
  max_output_tokens?: number | null
  user?: string | null
  metadata?: Record<string, string> | null
}

function partsToInputContent(
  parts: string | Array<ContentPart> | null,
  role: "user" | "assistant" | "system" | "developer",
): Array<ResponsesInputContentPart> {
  if (parts === null) return []
  const textType: "input_text" | "output_text" =
    role === "assistant" ? "output_text" : "input_text"
  if (typeof parts === "string") {
    return parts ? [{ type: textType, text: parts }] : []
  }
  const out: Array<ResponsesInputContentPart> = []
  for (const p of parts) {
    if (p.type === "text") {
      out.push({ type: textType, text: p.text })
    } else {
      out.push({ type: "input_image", image_url: p.image_url.url })
    }
  }
  return out
}

function toolMessageText(content: Message["content"]): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter(
      (p): p is Extract<ContentPart, { type: "text" }> => p.type === "text",
    )
    .map((p) => p.text)
    .join("\n")
}

function pushSystemChunks(m: Message, chunks: Array<string>): void {
  if (typeof m.content === "string") {
    chunks.push(m.content)
    return
  }
  if (Array.isArray(m.content)) {
    for (const p of m.content) {
      if (p.type === "text") chunks.push(p.text)
    }
  }
}

function pushAssistant(m: Message, items: Array<ResponsesInputItem>): void {
  const content = partsToInputContent(m.content, "assistant")
  if (content.length > 0) {
    items.push({ type: "message", role: "assistant", content })
  }
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      items.push({
        type: "function_call",
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })
    }
  }
}

function mapMessage(
  m: Message,
  instructionsChunks: Array<string>,
  items: Array<ResponsesInputItem>,
): void {
  if (m.role === "system" || m.role === "developer") {
    pushSystemChunks(m, instructionsChunks)
    return
  }
  if (m.role === "tool") {
    items.push({
      type: "function_call_output",
      call_id: m.tool_call_id ?? "",
      output: toolMessageText(m.content),
    })
    return
  }
  if (m.role === "assistant") {
    pushAssistant(m, items)
    return
  }
  items.push({
    type: "message",
    role: "user",
    content: partsToInputContent(m.content, "user"),
  })
}

function mapToolChoice(
  tc: ChatCompletionsPayload["tool_choice"],
): ResponsesPayload["tool_choice"] {
  if (typeof tc === "string") return tc
  if (tc && typeof tc === "object") {
    return { type: "function", name: tc.function.name }
  }
  return undefined
}

export function translateChatToResponses(
  payload: ChatCompletionsPayload,
): ResponsesPayload {
  const instructionsChunks: Array<string> = []
  const items: Array<ResponsesInputItem> = []

  for (const m of payload.messages) {
    mapMessage(m, instructionsChunks, items)
  }

  const tools = payload.tools?.map((t) => ({
    type: "function" as const,
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }))

  const instructions =
    instructionsChunks.length > 0 ? instructionsChunks.join("\n\n") : undefined

  return {
    model: payload.model,
    instructions,
    input: items,
    tools,
    tool_choice: mapToolChoice(payload.tool_choice),
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    max_output_tokens: payload.max_tokens,
    user: payload.user,
  }
}

// ---------- Non-streaming response translation ----------

interface ResponsesOutputText {
  type: "output_text"
  text: string
}

interface ResponsesOutputMessage {
  type: "message"
  id?: string
  role: "assistant"
  content: Array<ResponsesOutputText | { type: string; text?: string }>
}

interface ResponsesOutputFunctionCall {
  type: "function_call"
  id?: string
  call_id: string
  name: string
  arguments: string
}

type ResponsesOutputItem =
  | ResponsesOutputMessage
  | ResponsesOutputFunctionCall
  | { type: "reasoning"; summary?: unknown }
  | { type: string; [key: string]: unknown }

export interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
}

export interface ResponsesFinalResponse {
  id: string
  object?: string
  created_at?: number
  status?: string
  model: string
  output: Array<ResponsesOutputItem>
  usage?: ResponsesUsage
}

function extractText(item: ResponsesOutputMessage): string {
  let buf = ""
  for (const c of item.content) {
    if (c.type === "output_text" && typeof c.text === "string") {
      buf += c.text
    }
  }
  return buf
}

function makeUsage(usage: ResponsesUsage | undefined) {
  if (!usage) return undefined
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cached = usage.input_tokens_details?.cached_tokens
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: usage.total_tokens ?? inputTokens + outputTokens,
    prompt_tokens_details:
      cached === undefined ? undefined : { cached_tokens: cached },
  }
}

export function translateResponsesToChat(
  res: ResponsesFinalResponse,
): ChatCompletionResponse {
  let textBuf = ""
  const toolCalls: Array<ToolCall> = []
  for (const item of res.output) {
    if (item.type === "message") {
      textBuf += extractText(item as ResponsesOutputMessage)
    } else if (item.type === "function_call") {
      const fc = item as ResponsesOutputFunctionCall
      toolCalls.push({
        id: fc.call_id || fc.id || "",
        type: "function",
        function: { name: fc.name, arguments: fc.arguments },
      })
    }
  }

  const finish_reason: ChatCompletionResponse["choices"][number]["finish_reason"] =
    toolCalls.length > 0 ? "tool_calls" : "stop"

  return {
    id: res.id,
    object: "chat.completion",
    created: res.created_at ?? Math.floor(Date.now() / 1000),
    model: res.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textBuf || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason,
      },
    ],
    usage: makeUsage(res.usage),
  }
}

// ---------- Streaming translation ----------

export interface ResponsesStreamState {
  id?: string
  model?: string
  toolCalls: Map<number, { id: string; name: string; index: number }>
  toolCallOrder: Array<string>
}

export function makeResponsesStreamState(): ResponsesStreamState {
  return { toolCalls: new Map(), toolCallOrder: [] }
}

interface ParsedEvent {
  type?: string
  response?: {
    id?: string
    model?: string
    usage?: ResponsesUsage
    output?: Array<ResponsesOutputItem>
  }
  item?: ResponsesOutputItem & {
    output_index?: number
    id?: string
    call_id?: string
    name?: string
  }
  output_index?: number
  delta?: string
  arguments?: string
}

function makeBase(state: ResponsesStreamState) {
  return {
    id: state.id ?? "responses-stream",
    object: "chat.completion.chunk" as const,
    created: Math.floor(Date.now() / 1000),
    model: state.model ?? "",
  }
}

function handleItemAdded(
  e: ParsedEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const item = e.item
  if (item?.type !== "function_call") return []
  const callId = item.call_id ?? item.id ?? ""
  const idx = item.output_index ?? state.toolCallOrder.length
  state.toolCalls.set(idx, { id: callId, name: item.name ?? "", index: idx })
  state.toolCallOrder.push(callId)
  return [
    {
      ...makeBase(state),
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: idx,
                id: callId,
                type: "function",
                function: { name: item.name ?? "", arguments: "" },
              },
            ],
          },
          finish_reason: null,
          logprobs: null,
        },
      ],
    },
  ]
}

function handleTextDelta(
  e: ParsedEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  if (typeof e.delta !== "string" || e.delta.length === 0) return []
  return [
    {
      ...makeBase(state),
      choices: [
        {
          index: 0,
          delta: { content: e.delta },
          finish_reason: null,
          logprobs: null,
        },
      ],
    },
  ]
}

function handleArgsDelta(
  e: ParsedEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const idx = e.output_index ?? 0
  const argsDelta = e.delta ?? ""
  if (!argsDelta) return []
  return [
    {
      ...makeBase(state),
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: idx, function: { arguments: argsDelta } }],
          },
          finish_reason: null,
          logprobs: null,
        },
      ],
    },
  ]
}

function usageChunk(
  state: ResponsesStreamState,
  u: ResponsesUsage,
): ChatCompletionChunk {
  const cached = u.input_tokens_details?.cached_tokens
  const reasoning = u.output_tokens_details?.reasoning_tokens
  return {
    ...makeBase(state),
    choices: [],
    usage: {
      prompt_tokens: u.input_tokens ?? 0,
      completion_tokens: u.output_tokens ?? 0,
      total_tokens:
        u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
      prompt_tokens_details:
        cached === undefined ? undefined : { cached_tokens: cached },
      completion_tokens_details:
        reasoning === undefined ? undefined : (
          { accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 }
        ),
    },
  }
}

function handleCompleted(
  e: ParsedEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const resp = e.response
  if (resp?.id) state.id = resp.id
  if (resp?.model) state.model = resp.model
  const finish_reason: NonNullable<
    ChatCompletionChunk["choices"][number]["finish_reason"]
  > = state.toolCallOrder.length > 0 ? "tool_calls" : "stop"

  const chunks: Array<ChatCompletionChunk> = [
    {
      ...makeBase(state),
      choices: [{ index: 0, delta: {}, finish_reason, logprobs: null }],
    },
  ]
  if (resp?.usage) chunks.push(usageChunk(state, resp.usage))
  return chunks
}

function emptyStop(state: ResponsesStreamState): Array<ChatCompletionChunk> {
  return [
    {
      ...makeBase(state),
      choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
    },
  ]
}

/**
 * Translate one parsed Responses-API SSE event into zero or more OpenAI
 * chat.completion.chunk objects (already in object form — caller serializes).
 */
export function translateResponsesEventToChatChunks(
  event: unknown,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const e = event as ParsedEvent
  const type = e.type ?? ""
  if (type === "response.created" || type === "response.in_progress") {
    if (e.response?.id) state.id = e.response.id
    if (e.response?.model) state.model = e.response.model
    return []
  }
  if (type === "response.output_item.added") return handleItemAdded(e, state)
  if (type === "response.output_text.delta") return handleTextDelta(e, state)
  if (type === "response.function_call_arguments.delta") {
    return handleArgsDelta(e, state)
  }
  if (type === "response.completed") return handleCompleted(e, state)
  if (type === "response.failed" || type === "response.incomplete") {
    return emptyStop(state)
  }
  return []
}
