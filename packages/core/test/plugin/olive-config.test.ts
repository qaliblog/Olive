import { Location } from "@olive/core/location"
import { Model } from "@olive/core/model"
import { Plugin } from "@olive/core/plugin"
import { PluginHost } from "@olive/core/plugin/host"
import { OliveConfigPlugin } from "@olive/core/plugin/provider/olive-config"
import { Provider } from "@olive/core/provider"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* OliveConfigPlugin.effect(host)
})

const write = (directory: string, document: unknown) =>
  Effect.promise(async () => {
    await mkdir(path.join(directory, ".olive"), { recursive: true })
    await writeFile(path.join(directory, ".olive", "olive.json"), JSON.stringify(document))
  })

describe("OliveConfigPlugin", () => {
  test("is registered as a built-in provider plugin", () => {
    expect(OliveConfigPlugin.id).toBe("olive.provider.olive-config")
  })

  it.live("registers declared providers and models for the TUI and session runner", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      yield* write(location.directory, {
        providers: {
          local: {
            id: "local",
            name: "Local Olive",
            type: "openai-compatible",
            baseURL: "http://127.0.0.1:9999/v1",
            apiKeyEnv: "OLIVE_PLUGIN_TEST_KEY",
            models: [{ id: "olive", name: "Olive", context: 4096, maxOutput: 512, tools: true }],
          },
        },
        default: { provider: "local", model: "olive" },
      })
      yield* addPlugin()
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("local")
      expect(yield* providers.get(providerID)).toMatchObject({
        name: "Local Olive",
        activation: "enabled",
        package: "@olive/ai/providers/openai-compatible",
        settings: { baseURL: "http://127.0.0.1:9999/v1", provider: "local", apiKey: "" },
      })
      expect(yield* models.get(providerID, Model.ID.make("olive"))).toMatchObject({
        modelID: "olive",
        name: "Olive",
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 4096, output: 512 },
        enabled: true,
      })
      expect((yield* models.available()).map((model) => String(model.id))).toContain("olive")
      expect(yield* models.default()).toMatchObject({ providerID: "local", id: "olive" })
    }),
  )

  it.live("registers nothing without an Olive document", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const providers = yield* Provider.Service
      expect((yield* providers.available()).map((provider) => String(provider.id))).not.toContain("local")
    }),
  )

  it.live("maps an Ollama provider onto its OpenAI-compatible surface", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      yield* write(location.directory, {
        providers: {
          ollama: {
            id: "ollama",
            type: "ollama",
            baseURL: "http://127.0.0.1:11434",
            models: [{ id: "olive", context: 2048, maxOutput: 256 }],
          },
        },
      })
      yield* addPlugin()
      const providers = yield* Provider.Service
      expect((yield* providers.get(Provider.ID.make("ollama")))?.settings).toMatchObject({
        baseURL: "http://127.0.0.1:11434/v1",
      })
    }),
  )
})
