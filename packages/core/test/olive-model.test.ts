import { describe, expect, test } from "bun:test"
import { OliveModel } from "../src/olive/model.js"
import { OliveProvider } from "../src/olive/provider.js"

const target = (overrides: Partial<OliveProvider.ProviderConfig> = {}) =>
  OliveProvider.resolveProvider(
    {
      id: "local",
      type: "openai-compatible",
      baseURL: "http://127.0.0.1:11434/v1",
      models: [{ id: "olive", context: 4096, maxOutput: 512, tools: true, json: true, tokenizer: "olive-bpe" }],
      ...overrides,
    },
    {},
  )

describe("olive model adapter", () => {
  test("reports only the declared window, output size, and capabilities", () => {
    expect(OliveModel.describe(target(), "olive")).toMatchObject({
      context: 4096,
      maxOutput: 512,
      tools: true,
      json: true,
      runtime: "openai-compatible",
      local: true,
      tokenizer: { kind: "declared", name: "olive-bpe" },
    })
  })

  test("reports an unknown tokenizer instead of inventing one", () => {
    const provider = target({ models: [{ id: "tiny", context: 2048, maxOutput: 256 }] })
    expect(OliveModel.describe(provider, "tiny").tokenizer).toEqual({ kind: "unknown" })
  })

  test("refuses an unconfigured model", () => {
    expect(() => OliveModel.describe(target(), "missing")).toThrow(OliveProvider.ProviderDiagnostic)
  })

  test("maps llama.cpp models onto the OpenAI-compatible protocol", () => {
    const provider = target({ id: "cpp", type: "llama-cpp", baseURL: "http://127.0.0.1:8080/v1" })
    expect(OliveModel.describe(provider, "olive").runtime).toBe("llama-cpp")
    expect(OliveProvider.chatURL(provider)).toBe("http://127.0.0.1:8080/v1/chat/completions")
  })

  test("refuses runtimes that do not exist yet", () => {
    expect(() => OliveModel.adapter(target({ type: "gguf" }), "olive")).toThrow("not available yet")
    expect(() => OliveModel.adapter(target({ type: "olive-native" }), "olive")).toThrow("not available yet")
  })

  test("resolves the document default and an explicit provider/model", () => {
    const provider = target()
    const registry: OliveProvider.Registry = {
      providers: [provider],
      default: { provider: "local", model: "olive" },
      sources: [],
    }
    expect(OliveModel.resolve(registry)).toMatchObject({ model: { id: "olive" } })
    expect(OliveModel.resolve(registry, "local/olive")).toMatchObject({ provider: { id: "local" } })
    expect(OliveModel.resolve({ providers: [], sources: [] })).toBeInstanceOf(OliveProvider.ProviderDiagnostic)
  })
})
