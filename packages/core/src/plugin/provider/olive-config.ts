import { Effect } from "effect"
import { define } from "@olive/plugin/effect/plugin"
import { Location } from "../../location.js"
import { Model } from "../../model.js"
import { OliveProvider } from "../../olive/provider.js"
import { Provider } from "../../provider.js"

/**
 * Makes the providers declared in Olive's own olive.json selectable by the regular TUI and session runner. Every
 * provider is registered through the generic OpenAI-compatible package, so nothing is read from the inherited catalog,
 * and each model only advertises the context size, output limit, and capabilities its document declares.
 */
export const OliveConfigPlugin = define({
  id: "olive.provider.olive-config",
  effect: Effect.fn(function* (ctx) {
    const location = yield* Location.Service
    const registry = yield* Effect.promise(() => OliveProvider.load({ directory: location.directory }))
    if (registry.providers.length === 0) return
    const targets = registry.providers.flatMap((provider) => {
      const baseURL = apiRoot(provider)
      return baseURL ? [{ provider, baseURL }] : []
    })
    if (targets.length === 0) return
    yield* ctx.provider.transform((providers) => {
      for (const { provider, baseURL } of targets) {
        const id = Provider.ID.make(provider.id)
        providers.update(id, (draft) => {
          draft.name = provider.name
          draft.activation = "enabled"
          draft.package = "@olive/ai/providers/openai-compatible"
          draft.settings = {
            baseURL,
            provider: provider.id,
            apiKey: OliveProvider.credential(provider) ?? "",
          }
          draft.headers = { ...provider.headers }
          draft.integrationID = undefined
        })
        for (const model of provider.models)
          providers.models.update(id, Model.ID.make(model.id), (draft) => {
            draft.modelID = Model.ID.make(model.model)
            draft.name = model.name
            draft.capabilities = { tools: model.tools, input: ["text"], output: ["text"] }
            draft.limit.context = model.context
            draft.limit.output = model.maxOutput
            draft.enabled = true
          })
      }
    })
    // The declared default decides what the TUI and a model-less session start with, instead of whichever inherited
    // model happens to be listed first.
    yield* ctx.model.transform((models) => {
      const preferred = registry.default
      if (!preferred) return
      const providerID = Provider.ID.make(preferred.provider)
      const modelID = Model.ID.make(preferred.model)
      if (models.get(providerID, modelID) === undefined) return
      models.default.set(providerID, modelID)
    })
  }),
})

/** The OpenAI-compatible API root. Ollama exposes that surface under `/v1`; native runtimes are not registered. */
function apiRoot(provider: OliveProvider.LoadedProvider) {
  if (provider.type === "gguf" || provider.type === "olive-native") return undefined
  const base = (provider.endpoint ?? provider.baseURL)
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|api\/chat)$/, "")
  if (provider.protocol !== "ollama-chat") return base
  return /\/v1$/.test(base) ? base : `${base}/v1`
}
