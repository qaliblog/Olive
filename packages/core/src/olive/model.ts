export * as OliveModel from "./model.js"

import { OliveProvider } from "./provider.js"

/**
 * The model adapter is deliberately thin. It never guesses a context window, a tokenizer, or a capability: every value
 * comes from the provider document, and a runtime Olive cannot speak to yet fails loudly instead of silently pretending
 * to be an OpenAI-compatible endpoint.
 */
export const Runtime = ["openai-compatible", "ollama", "llama-cpp", "gguf", "olive-native"] as const
export type Runtime = (typeof Runtime)[number]

export type Tokenizer = { readonly kind: "declared"; readonly name: string } | { readonly kind: "unknown" }

export interface Descriptor {
  readonly id: string
  /** Model id sent to the endpoint. */
  readonly model: string
  readonly name: string
  readonly provider: string
  readonly runtime: Runtime
  /** Declared capacity of this model at this endpoint. */
  readonly context: number
  readonly maxOutput: number
  readonly streaming: boolean
  readonly tools: boolean
  readonly json: boolean
  readonly local: boolean
  readonly tokenizer: Tokenizer
}

export interface ModelAdapter {
  readonly descriptor: Descriptor
  readonly chat: (request: OliveProvider.ChatRequest) => AsyncGenerator<OliveProvider.ChatEvent, void, void>
}

function runtimeOf(target: OliveProvider.LoadedProvider): Runtime {
  if (target.type === "ollama") return "ollama"
  if (target.type === "llama-cpp") return "llama-cpp"
  if (target.type === "gguf") return "gguf"
  if (target.type === "olive-native") return "olive-native"
  return "openai-compatible"
}

/** Reads the declared capacity of one configured model. Throws a diagnostic instead of inventing a default. */
export function describe(target: OliveProvider.LoadedProvider, id: string): Descriptor {
  const model = OliveProvider.model(target, id)
  if (!model)
    throw new OliveProvider.ProviderDiagnostic(
      "invalid-model",
      `${target.id}: model ${id} is not configured`,
      undefined,
      target.id,
    )
  if (model.context < 2 || model.maxOutput < 1)
    throw new OliveProvider.ProviderDiagnostic(
      "invalid-model",
      `${target.id}/${id}: context must be at least 2 and maxOutput at least 1`,
      undefined,
      target.id,
    )
  return {
    id: model.id,
    model: model.model,
    name: model.name,
    provider: target.id,
    runtime: runtimeOf(target),
    context: model.context,
    maxOutput: model.maxOutput,
    streaming: model.streaming,
    tools: model.tools,
    json: model.json,
    local: target.local,
    tokenizer: model.tokenizer ? { kind: "declared", name: model.tokenizer } : { kind: "unknown" },
  }
}

/**
 * Builds the adapter for one model. GGUF and the native Olive runtime are reserved for a future in-process backend:
 * until that backend exists they are reported as unsupported rather than routed through the wrong protocol.
 */
export function adapter(
  target: OliveProvider.LoadedProvider,
  id: string,
  options: OliveProvider.AdapterOptions = {},
): ModelAdapter {
  const descriptor = describe(target, id)
  if (descriptor.runtime === "gguf" || descriptor.runtime === "olive-native")
    throw new OliveProvider.ProviderDiagnostic(
      "unsupported-runtime",
      `${target.id}/${id}: the ${descriptor.runtime} runtime is not available yet; point this model at a local inference server instead`,
      undefined,
      target.id,
    )
  const model = OliveProvider.model(target, id)!
  const base = OliveProvider.adapter(target, options)
  return { descriptor, chat: (request) => base.chat({ ...request, model }) }
}

export interface Resolution {
  readonly provider: OliveProvider.LoadedProvider
  readonly model: OliveProvider.LoadedModel
}

/** Resolves `provider/model` or the document default, so no catalog or model family is consulted. */
export function resolve(
  registry: OliveProvider.Registry,
  requested?: string,
): Resolution | OliveProvider.ProviderDiagnostic {
  const [providerID, modelID] = requested ? split(requested, registry) : [undefined, undefined]
  const id = providerID ?? registry.default?.provider
  if (!id)
    return new OliveProvider.ProviderDiagnostic(
      "missing-provider",
      "no provider is configured; add one to ~/.config/olive/olive.json or .olive/olive.json",
    )
  const provider = OliveProvider.provider(registry, id)
  if (!provider)
    return new OliveProvider.ProviderDiagnostic("missing-provider", `provider ${id} is not configured`, undefined, id)
  const model = OliveProvider.model(provider, modelID ?? registry.default?.model ?? provider.models[0]?.id ?? "")
  if (!model)
    return new OliveProvider.ProviderDiagnostic(
      "invalid-model",
      `${id}: no model ${modelID ?? registry.default?.model ?? ""} is configured`,
      undefined,
      id,
    )
  return { provider, model }
}

function split(requested: string, registry: OliveProvider.Registry): [string | undefined, string | undefined] {
  const [first, ...rest] = requested.split("/")
  if (rest.length === 0) return [undefined, first]
  if (OliveProvider.provider(registry, first)) return [first, rest.join("/")]
  return [undefined, requested]
}
