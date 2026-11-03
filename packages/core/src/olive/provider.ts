export * as OliveProvider from "./provider.js"

import path from "node:path"
import { Option, Schema } from "effect"

/**
 * Olive's own provider configuration. Nothing here is inherited from the upstream catalog: the registry is empty
 * until a document declares a provider, and every capability the agent relies on (context size, output size, tools,
 * JSON output, streaming) is stated explicitly instead of assumed from a model family.
 */
export const Type = Schema.Literals(["openai-compatible", "ollama", "llama-cpp", "gguf", "olive-native"])
export type Type = typeof Type.Type

export const Protocol = Schema.Literals(["chat-completions", "ollama-chat", "olive-native"])
export type Protocol = typeof Protocol.Type

export const ModelConfig = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  /** Real capacity of the endpoint for this model. The agent never assumes 32K, 128K or any other window. */
  context: Schema.Int.check(Schema.isGreaterThan(0)),
  maxOutput: Schema.Int.check(Schema.isGreaterThan(0)),
  /** Model id the endpoint expects, when it differs from the config key. */
  model: Schema.optional(Schema.String),
  streaming: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Boolean),
  json: Schema.optional(Schema.Boolean),
  tokenizer: Schema.optional(Schema.String),
})
export type ModelConfig = typeof ModelConfig.Type

export const ProviderConfig = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  type: Type,
  /** API root, for example `http://127.0.0.1:11434/v1`. The chat path is appended by the adapter. */
  baseURL: Schema.String,
  /** Full chat URL. Takes precedence over `baseURL`; the adapter never rewrites it. */
  endpoint: Schema.optional(Schema.String),
  protocol: Schema.optional(Protocol),
  /** Literal key. Prefer `apiKeyEnv` so config files carry no secrets. */
  apiKey: Schema.optional(Schema.String),
  apiKeyEnv: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(1))),
  retries: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  local: Schema.optional(Schema.Boolean),
  models: Schema.Array(ModelConfig),
})
export type ProviderConfig = typeof ProviderConfig.Type

export const Document = Schema.Struct({
  providers: Schema.optional(Schema.Record(Schema.String, ProviderConfig)),
  default: Schema.optional(Schema.Struct({ provider: Schema.String, model: Schema.String })),
})
export type Document = typeof Document.Type

export interface LoadedModel {
  readonly id: string
  /** Model id sent to the endpoint. */
  readonly model: string
  readonly name: string
  readonly context: number
  readonly maxOutput: number
  readonly streaming: boolean
  readonly tools: boolean
  readonly json: boolean
  readonly tokenizer?: string
}

export interface LoadedProvider {
  readonly id: string
  readonly name: string
  readonly type: Type
  readonly protocol: Protocol
  readonly baseURL: string
  readonly endpoint?: string
  readonly headers: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly retries: number
  readonly local: boolean
  readonly models: readonly LoadedModel[]
  /** Environment variable that holds the key, when configured through one. */
  readonly apiKeyEnv?: string
  /** Literal key from the document. It is never rendered; prefer `apiKeyEnv` so config files hold no secrets. */
  readonly apiKey?: string
  readonly hasCredential: boolean
}

export interface Registry {
  readonly providers: readonly LoadedProvider[]
  readonly default?: { readonly provider: string; readonly model: string }
  /** Config files that contributed, lowest precedence first. */
  readonly sources: readonly string[]
}

export const empty: Registry = { providers: [], sources: [] }

export type DiagnosticCode =
  | "missing-provider"
  | "missing-credential"
  | "invalid-endpoint"
  | "method-not-allowed"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "invalid-response"
  | "stream-failure"
  | "context-overflow"
  | "unsupported-tools"
  | "invalid-json"
  | "invalid-model"
  | "unsupported-runtime"
  | "timeout"
  | "http-error"

export class ProviderDiagnostic extends Error {
  constructor(
    readonly code: DiagnosticCode,
    message: string,
    readonly status?: number,
    readonly provider?: string,
  ) {
    super(message)
    this.name = "ProviderDiagnostic"
  }
}

const decodeDocument = Schema.decodeUnknownOption(Document)
const decodeJSON = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/** Parses one config document, returning undefined instead of throwing so a bad file cannot take down the CLI. */
export function parseDocument(input: unknown): Document | undefined {
  return Option.getOrUndefined(decodeDocument(input))
}

export interface LoadOptions {
  /** Project directory holding `.olive/olive.json`. Defaults to the working directory. */
  readonly directory?: string
  /** Home directory holding `.config/olive/olive.json`. Defaults to `os.homedir()`. */
  readonly home?: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

export const globalPath = (home: string) => path.join(home, ".config", "olive", "olive.json")
export const projectPath = (directory: string) => path.join(directory, ".olive", "olive.json")

/** Reads the global then the project document. Project settings win; the registry is empty without files. */
export async function load(options: LoadOptions = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? process.env.HOME ?? process.env.USERPROFILE ?? ""
  const directory = options.directory ?? process.cwd()
  const globalDocument = await readDocument(globalPath(home))
  const projectDocument = await readDocument(projectPath(directory))
  const sources = [globalDocument && globalPath(home), projectDocument && projectPath(directory)].filter(
    (source): source is string => Boolean(source),
  )
  const document = mergeDocuments(globalDocument?.document, projectDocument?.document)
  if (!document) return { providers: [], sources } satisfies Registry
  const providers = Object.values(document.providers ?? {}).map((provider) => resolveProvider(provider, env))
  return { providers, default: document.default, sources } satisfies Registry
}

async function readDocument(file: string) {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return undefined
  const document = Option.getOrUndefined(decodeJSON(await handle.text()))
  if (document === undefined) return undefined
  return { path: file, document: parseDocument(document) }
}

function mergeDocuments(global: Document | undefined, project: Document | undefined): Document | undefined {
  if (!global) return project
  if (!project) return global
  const providers: Record<string, ProviderConfig> = { ...global.providers }
  for (const [id, provider] of Object.entries(project.providers ?? {})) {
    const inherited = providers[id]
    providers[id] = inherited ? { ...inherited, ...provider, models: mergeModels(inherited.models, provider.models) } : provider
  }
  return { providers, default: project.default ?? global.default }
}

function mergeModels(global: readonly ModelConfig[], project: readonly ModelConfig[]) {
  const merged = new Map(global.map((model) => [model.id, model]))
  for (const model of project) merged.set(model.id, model)
  return Array.from(merged.values())
}

export function resolveProvider(config: ProviderConfig, env: Readonly<Record<string, string | undefined>> = process.env) {
  const protocol = config.protocol ?? (config.type === "ollama" ? "ollama-chat" : "chat-completions")
  const apiKey = config.apiKeyEnv ? env[config.apiKeyEnv] : config.apiKey
  return {
    id: config.id,
    name: config.name ?? config.id,
    type: config.type,
    protocol,
    baseURL: config.baseURL,
    endpoint: config.endpoint,
    headers: config.headers ?? {},
    timeoutMs: config.timeoutMs ?? 120_000,
    retries: config.retries ?? 0,
    local: config.local ?? (protocol === "ollama-chat" || isLoopback(config.endpoint ?? config.baseURL)),
    models: config.models.map((model) => ({
      id: model.id,
      model: model.model ?? model.id,
      name: model.name ?? model.id,
      context: model.context,
      maxOutput: model.maxOutput,
      streaming: model.streaming ?? true,
      tools: model.tools ?? false,
      json: model.json ?? false,
      tokenizer: model.tokenizer,
    })),
    apiKeyEnv: config.apiKeyEnv,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    hasCredential: Boolean(apiKey),
  } satisfies LoadedProvider
}

function isLoopback(value: string) {
  const parsed = URL.parse(value)
  if (!parsed) return false
  return ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"].includes(parsed.hostname)
}

export function provider(registry: Registry, id: string) {
  return registry.providers.find((item) => item.id === id)
}

export function model(provider: LoadedProvider, id: string) {
  return provider.models.find((item) => item.id === id)
}

/**
 * The request URL for a provider. A `baseURL` that already points at the chat path is rejected here instead of
 * producing a doubled path and an HTTP 405 from the endpoint.
 */
export function chatURL(target: LoadedProvider): string {
  if (target.endpoint) return absoluteURL(target.endpoint, target)
  const base = target.baseURL.replace(/\/+$/, "")
  if (/\/(chat\/completions|api\/chat)$/.test(base))
    throw new ProviderDiagnostic(
      "invalid-endpoint",
      `${target.id}: baseURL must be the API root without the chat path (got ${base})`,
      undefined,
      target.id,
    )
  return absoluteURL(`${base}${target.protocol === "ollama-chat" ? "/api/chat" : "/chat/completions"}`, target)
}

function absoluteURL(value: string, target: LoadedProvider) {
  const parsed = URL.parse(value)
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:"))
    throw new ProviderDiagnostic("invalid-endpoint", `${target.id}: endpoint must be an http(s) URL (got ${value})`, undefined, target.id)
  return parsed.toString()
}

export function credential(target: LoadedProvider, env: Readonly<Record<string, string | undefined>> = process.env) {
  const value = target.apiKeyEnv ? env[target.apiKeyEnv] : target.apiKey
  return value && value.length > 0 ? value : undefined
}

/** Removes configured secrets from text that may reach a log or a tool result. */
export function redact(text: string, secrets: readonly (string | undefined)[]) {
  return secrets.reduce<string>((result, secret) => (secret ? result.split(secret).join("[redacted]") : result), text)
}

export type ChatRole = "system" | "user" | "assistant" | "tool"

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: string
}

export interface ChatMessage {
  readonly role: ChatRole
  readonly content: string
  /** Set on a `tool` message so the endpoint can pair it with the assistant tool call. */
  readonly toolCallId?: string
  /** Set on the assistant message that requested tools. */
  readonly toolCalls?: readonly ToolCall[]
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

export interface ChatRequest {
  readonly model: LoadedModel
  readonly messages: readonly ChatMessage[]
  readonly tools?: readonly ToolDefinition[]
  readonly json?: boolean
  readonly temperature?: number
  readonly maxOutput?: number
  readonly signal?: AbortSignal
}

export type ChatEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool-call"; readonly id: string; readonly name: string; readonly arguments: string }
  | { readonly type: "usage"; readonly input: number; readonly output: number }
  | { readonly type: "done" }

export interface Adapter {
  readonly id: string
  /** Streaming chat. Each event is yielded as soon as the endpoint produces it. */
  readonly chat: (request: ChatRequest) => AsyncGenerator<ChatEvent, void, void>
}

export interface AdapterOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly env?: Readonly<Record<string, string | undefined>>
}

const ChunkToolCall = Schema.Struct({
  index: Schema.optional(Schema.Int),
  id: Schema.optional(Schema.String),
  function: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.String), arguments: Schema.optional(Schema.String) }),
  ),
})

const Chunk = Schema.Struct({
  choices: Schema.optional(
    Schema.Array(
      Schema.Struct({
        delta: Schema.optional(
          Schema.Struct({
            content: Schema.optional(Schema.String),
            tool_calls: Schema.optional(Schema.Array(ChunkToolCall)),
          }),
        ),
        finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  usage: Schema.optional(
    Schema.Struct({ prompt_tokens: Schema.optional(Schema.Int), completion_tokens: Schema.optional(Schema.Int) }),
  ),
  error: Schema.optional(
    Schema.Struct({ message: Schema.optional(Schema.String), type: Schema.optional(Schema.String), code: Schema.optional(Schema.String) }),
  ),
})

const OllamaChunk = Schema.Struct({
  message: Schema.optional(
    Schema.Struct({
      content: Schema.optional(Schema.String),
      tool_calls: Schema.optional(
        Schema.Array(
          Schema.Struct({
            id: Schema.optional(Schema.String),
            function: Schema.Struct({ name: Schema.String, arguments: Schema.optional(Schema.Unknown) }),
          }),
        ),
      ),
    }),
  ),
  done: Schema.optional(Schema.Boolean),
  prompt_eval_count: Schema.optional(Schema.Int),
  eval_count: Schema.optional(Schema.Int),
  error: Schema.optional(Schema.String),
})

const decodeChunk = Schema.decodeUnknownOption(Chunk)
const decodeOllamaChunk = Schema.decodeUnknownOption(OllamaChunk)
const decodeErrorBody = Schema.decodeUnknownOption(
  Schema.Struct({ error: Schema.optional(Schema.Union([Schema.String, Schema.Struct({ message: Schema.optional(Schema.String) })])) }),
)

export const DEFAULT_TIMEOUT_MS = 120_000

/** Builds the adapter for an Olive provider. Unknown types fail loudly instead of silently using a wrong protocol. */
export function adapter(target: LoadedProvider, options: AdapterOptions = {}): Adapter {
  if (target.type === "olive-native")
    throw new ProviderDiagnostic(
      "missing-provider",
      `${target.id}: the Olive native runtime is not available yet; configure an OpenAI-compatible endpoint instead`,
      undefined,
      target.id,
    )
  if (!target.models.length)
    throw new ProviderDiagnostic("missing-provider", `${target.id}: no models are configured`, undefined, target.id)
  return target.protocol === "ollama-chat"
    ? { id: `${target.id}.ollama`, chat: (request) => ollamaChat(target, request, options) }
    : { id: `${target.id}.openai`, chat: (request) => openAIChat(target, request, options) }
}

function timeoutSignal(timeoutMs: number, outer?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return outer ? AbortSignal.any([timeout, outer]) : timeout
}

function headers(target: LoadedProvider, options: AdapterOptions) {
  const key = credential(target, options.env ?? process.env)
  return {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...target.headers,
    ...(key ? { authorization: `Bearer ${key}` } : {}),
  }
}

async function post(target: LoadedProvider, request: ChatRequest, body: unknown, options: AdapterOptions) {
  const send = options.fetch ?? globalThis.fetch
  const env = options.env ?? process.env
  const response = await send(chatURL(target), {
    method: "POST",
    headers: headers(target, options),
    body: JSON.stringify(body),
    signal: timeoutSignal(target.timeoutMs, request.signal),
  }).catch((cause: unknown) => {
    if (cause instanceof Error && cause.name === "TimeoutError")
      throw new ProviderDiagnostic("timeout", `${target.id}: no response within ${target.timeoutMs}ms`, undefined, target.id)
    if (cause instanceof Error && cause.name === "AbortError")
      throw new ProviderDiagnostic("timeout", `${target.id}: request aborted`, undefined, target.id)
    throw new ProviderDiagnostic(
      "invalid-endpoint",
      `${target.id}: cannot reach ${chatURL(target)} (${cause instanceof Error ? cause.message : "unknown error"})`,
      undefined,
      target.id,
    )
  })
  if (!response.ok) throw await diagnose(response, target, credential(target, env))
  return response
}

async function diagnose(response: Response, target: LoadedProvider, secret: string | undefined) {
  const text = redact((await response.text().catch(() => "")).slice(0, 300), [secret])
  const detail = errorDetail(text) ?? text
  const suffix = detail ? `: ${detail}` : ""
  const withStatus = (code: DiagnosticCode, message: string) => new ProviderDiagnostic(code, `${target.id}: ${message}${suffix}`, response.status, target.id)
  if (response.status === 401) return withStatus("unauthorized", "the endpoint rejected the credential (HTTP 401)")
  if (response.status === 403) return withStatus("forbidden", "the credential is not allowed to use this model (HTTP 403)")
  if (response.status === 404) return withStatus("not-found", `no chat endpoint at ${response.url || chatURL(target)} (HTTP 404)`)
  if (response.status === 405) return withStatus("method-not-allowed", `the endpoint rejected POST (HTTP 405); check the configured chat URL`)
  if (response.status === 400 && /context|token/i.test(text))
    return withStatus("context-overflow", "the request exceeded the model's context window")
  if (response.status === 400 && /tool|function/i.test(text))
    return withStatus("unsupported-tools", "the endpoint does not accept tool definitions")
  return withStatus("http-error", `request failed (HTTP ${response.status})`)
}

function errorDetail(text: string) {
  const parsed = Option.getOrUndefined(decodeErrorBody(Option.getOrUndefined(decodeJSON(text)) ?? undefined))
  if (!parsed?.error) return text.trim() || undefined
  return typeof parsed.error === "string" ? parsed.error : parsed.error.message
}

function body(target: LoadedProvider, request: ChatRequest, extra: Record<string, unknown>) {
  return {
    model: request.model.model,
    messages: request.messages.map((message) => wireMessage(message, target.protocol)),
    stream: request.model.streaming,
    ...(request.maxOutput ? { max_tokens: Math.min(request.maxOutput, request.model.maxOutput) } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...extra,
  }
}

/** Tool calls and results need their wire shape; Ollama accepts plain roles only, OpenAI-compatible needs the ids. */
function wireMessage(message: ChatMessage, protocol: Protocol) {
  if (protocol === "ollama-chat") return { role: message.role, content: message.content }
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls?.length
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        }
      : {}),
  }
}

function tools(target: LoadedProvider, request: ChatRequest) {
  if (!request.tools?.length) return {}
  if (!request.model.tools)
    throw new ProviderDiagnostic(
      "unsupported-tools",
      `${target.id}/${request.model.id}: tool calling is not declared for this model`,
      undefined,
      target.id,
    )
  return {
    tools: request.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    })),
  }
}

function jsonMode(request: ChatRequest) {
  if (!request.json) return {}
  if (!request.model.json)
    throw new ProviderDiagnostic("invalid-json", `model ${request.model.id} does not declare JSON output support`)
  return { response_format: { type: "json_object" } }
}

async function* openAIChat(target: LoadedProvider, request: ChatRequest, options: AdapterOptions): AsyncGenerator<ChatEvent, void, void> {
  const response = await post(target, request, body(target, request, { ...tools(target, request), ...jsonMode(request) }), options)
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  for await (const payload of sse(response, target)) {
    if (payload === "[DONE]") {
      for (const call of calls.values()) yield { type: "tool-call", ...call }
      yield { type: "done" }
      return
    }
    const chunk = Option.getOrUndefined(decodeChunk(Option.getOrUndefined(decodeJSON(payload)) ?? undefined))
    if (!chunk) throw new ProviderDiagnostic("invalid-response", `${target.id}: unreadable stream chunk`, undefined, target.id)
    if (chunk.error) throw new ProviderDiagnostic("invalid-response", `${target.id}: ${chunk.error.message ?? "endpoint error"}`, undefined, target.id)
    for (const choice of chunk.choices ?? []) {
      if (choice.delta?.content) yield { type: "text", text: choice.delta.content }
      for (const call of choice.delta?.tool_calls ?? []) {
        const index = call.index ?? 0
        const current = calls.get(index) ?? { id: call.id ?? `call_${index}`, name: "", arguments: "" }
        calls.set(index, {
          id: call.id ?? current.id,
          name: current.name || call.function?.name || "",
          arguments: current.arguments + (call.function?.arguments ?? ""),
        })
      }
    }
    if (chunk.usage?.prompt_tokens !== undefined && chunk.usage.completion_tokens !== undefined)
      yield { type: "usage", input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens }
  }
  for (const call of calls.values()) yield { type: "tool-call", ...call }
  yield { type: "done" }
}

async function* ollamaChat(target: LoadedProvider, request: ChatRequest, options: AdapterOptions): AsyncGenerator<ChatEvent, void, void> {
  const response = await post(target, request, body(target, request, tools(target, request)), options)
  for await (const line of lines(response, target)) {
    const chunk = Option.getOrUndefined(decodeOllamaChunk(Option.getOrUndefined(decodeJSON(line)) ?? undefined))
    if (!chunk) throw new ProviderDiagnostic("invalid-response", `${target.id}: unreadable stream line`, undefined, target.id)
    if (chunk.error) throw new ProviderDiagnostic("invalid-response", `${target.id}: ${chunk.error}`, undefined, target.id)
    if (chunk.message?.content) yield { type: "text", text: chunk.message.content }
    for (const [index, call] of (chunk.message?.tool_calls ?? []).entries())
      yield {
        type: "tool-call",
        id: call.id ?? `call_${index}`,
        name: call.function.name,
        arguments: typeof call.function.arguments === "string" ? call.function.arguments : JSON.stringify(call.function.arguments ?? {}),
      }
    if (chunk.prompt_eval_count !== undefined && chunk.eval_count !== undefined)
      yield { type: "usage", input: chunk.prompt_eval_count, output: chunk.eval_count }
    if (chunk.done) {
      yield { type: "done" }
      return
    }
  }
  yield { type: "done" }
}

async function* sse(response: Response, target: LoadedProvider): AsyncGenerator<string, void, void> {
  for await (const line of lines(response, target)) {
    if (!line.startsWith("data:")) continue
    yield line.slice(5).trim()
  }
}

async function* lines(response: Response, target: LoadedProvider): AsyncGenerator<string, void, void> {
  const reader = response.body?.getReader()
  if (!reader) throw new ProviderDiagnostic("stream-failure", `${target.id}: response has no body`, undefined, target.id)
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const next = await reader.read().catch((cause: unknown) => {
      throw new ProviderDiagnostic(
        "stream-failure",
        `${target.id}: stream ended unexpectedly (${cause instanceof Error ? cause.message : "unknown error"})`,
        undefined,
        target.id,
      )
    })
    if (next.done) break
    buffer += decoder.decode(next.value, { stream: true })
    const parts = buffer.split("\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      const line = part.trim()
      if (line.length > 0) yield line
    }
  }
  const tail = buffer.trim()
  if (tail.length > 0) yield tail
}
