import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OliveProvider } from "../src/olive/provider.js"

const document = (baseURL: string) => ({
  providers: {
    local: {
      id: "local",
      name: "Local",
      type: "openai-compatible",
      baseURL,
      apiKeyEnv: "OLIVE_TEST_KEY",
      models: [{ id: "tiny", context: 8192, maxOutput: 512, tools: true, json: true }],
    },
  },
  default: { provider: "local", model: "tiny" },
})

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "olive-provider-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeDocument(directory: string, relative: string, value: unknown) {
  const file = path.join(directory, relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}

function registryFor(baseURL: string, env: Record<string, string | undefined> = {}) {
  const target = OliveProvider.resolveProvider(
    {
      id: "local",
      name: "Local",
      type: "openai-compatible",
      baseURL,
      apiKeyEnv: "OLIVE_TEST_KEY",
      models: [{ id: "tiny", context: 8192, maxOutput: 512, tools: true, json: true }],
    },
    env,
  )
  return { providers: [target], default: { provider: "local", model: "tiny" }, sources: [] }
}

function sse(chunks: readonly string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
}

function server(handler: (request: Request) => Response | Promise<Response>) {
  return Bun.serve({ port: 0, fetch: handler })
}

async function events(target: OliveProvider.LoadedProvider, request: OliveProvider.ChatRequest, options?: OliveProvider.AdapterOptions) {
  const collected: OliveProvider.ChatEvent[] = []
  for await (const event of OliveProvider.adapter(target, options).chat(request)) collected.push(event)
  return collected
}

const message = (content: string): OliveProvider.ChatMessage => ({ role: "user", content })

describe("olive provider registry", () => {
  test("starts empty without configuration", async () => {
    await withDirectory(async (directory) => {
      const registry = await OliveProvider.load({ home: directory, directory, env: {} })
      expect(registry.providers).toEqual([])
      expect(registry.default).toBeUndefined()
      expect(registry.sources).toEqual([])
    })
  })

  test("reads a provider from the project document and reports declared capabilities", async () => {
    await withDirectory(async (directory) => {
      await writeDocument(directory, ".olive/olive.json", document("http://127.0.0.1:11434/v1"))
      const registry = await OliveProvider.load({ home: path.join(directory, "home"), directory, env: {} })
      expect(registry.providers).toHaveLength(1)
      const target = OliveProvider.provider(registry, "local")
      expect(target?.protocol).toBe("chat-completions")
      expect(target?.models[0]).toMatchObject({ id: "tiny", context: 8192, maxOutput: 512, tools: true, json: true })
      expect(target?.hasCredential).toBe(false)
      expect(registry.default).toEqual({ provider: "local", model: "tiny" })
    })
  })

  test("project settings override global settings and merge models", async () => {
    await withDirectory(async (directory) => {
      const home = path.join(directory, "home")
      await writeDocument(home, ".config/olive/olive.json", {
        providers: {
          local: {
            id: "local",
            type: "openai-compatible",
            baseURL: "http://127.0.0.1:1111/v1",
            models: [
              { id: "tiny", context: 4096, maxOutput: 256 },
              { id: "shared", context: 2048, maxOutput: 128 },
            ],
          },
        },
      })
      await writeDocument(directory, ".olive/olive.json", {
        providers: {
          local: {
            id: "local",
            type: "openai-compatible",
            baseURL: "http://127.0.0.1:2222/v1",
            models: [
              { id: "tiny", context: 8192, maxOutput: 512 },
              { id: "project", context: 1024, maxOutput: 64 },
            ],
          },
        },
      })
      const registry = await OliveProvider.load({ home, directory, env: {} })
      const target = OliveProvider.provider(registry, "local")
      expect(target?.baseURL).toBe("http://127.0.0.1:2222/v1")
      expect(target?.models.map((item) => item.id).toSorted()).toEqual(["project", "shared", "tiny"])
      expect(OliveProvider.model(target!, "tiny")?.context).toBe(8192)
      expect(registry.sources).toHaveLength(2)
    })
  })

  test("resolves environment credentials and never renders them", async () => {
    await withDirectory(async (directory) => {
      await writeDocument(directory, ".olive/olive.json", document("http://127.0.0.1:1/v1"))
      const env = { OLIVE_TEST_KEY: "sk-secret-value" }
      const registry = await OliveProvider.load({ home: directory, directory, env })
      const target = OliveProvider.provider(registry, "local")!
      expect(target.hasCredential).toBe(true)
      expect(OliveProvider.credential(target, env)).toBe("sk-secret-value")
      expect(OliveProvider.redact("failure with sk-secret-value", ["sk-secret-value"])).toBe("failure with [redacted]")
    })
  })

  test("rejects a baseURL that already contains the chat path", () => {
    const target = OliveProvider.resolveProvider(
      {
        id: "local",
        type: "openai-compatible",
        baseURL: "http://127.0.0.1:1234/v1/chat/completions",
        models: [{ id: "tiny", context: 1024, maxOutput: 128 }],
      },
      {},
    )
    expect(() => OliveProvider.chatURL(target)).toThrow("must be the API root")
  })

  test("builds the chat URL per protocol", () => {
    const openai = OliveProvider.resolveProvider(
      { id: "a", type: "openai-compatible", baseURL: "http://127.0.0.1:1234/v1/", models: [{ id: "m", context: 1024, maxOutput: 128 }] },
      {},
    )
    const ollama = OliveProvider.resolveProvider(
      { id: "b", type: "ollama", baseURL: "http://127.0.0.1:11434", models: [{ id: "m", context: 1024, maxOutput: 128 }] },
      {},
    )
    expect(OliveProvider.chatURL(openai)).toBe("http://127.0.0.1:1234/v1/chat/completions")
    expect(OliveProvider.chatURL(ollama)).toBe("http://127.0.0.1:11434/api/chat")
  })
})

describe("olive provider streaming", () => {
  test("streams text and tool calls from an OpenAI-compatible endpoint", async () => {
    let received: { method: string; authorization: string | null; body: string } | undefined
    const mock = server(async (request) => {
      received = {
        method: request.method,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      }
      return sse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.ts\\"}"}}]}}]}\n\n',
        'data: {"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n',
        "data: [DONE]\n\n",
      ])
    })
    try {
      const registry = registryFor(`http://127.0.0.1:${mock.port}/v1`, { OLIVE_TEST_KEY: "sk-test" })
      const target = OliveProvider.provider(registry, "local")!
      const result = await events(
        target,
        { model: target.models[0], messages: [message("hi")] },
        { env: { OLIVE_TEST_KEY: "sk-test" } },
      )
      // Tool calls are emitted once fully assembled at end of stream, after any usage chunk.
      expect(result).toEqual([
        { type: "text", text: "Hel" },
        { type: "text", text: "lo" },
        { type: "usage", input: 11, output: 7 },
        { type: "tool-call", id: "call_1", name: "read_file", arguments: '{"path":"a.ts"}' },
        { type: "done" },
      ])
      expect(received?.method).toBe("POST")
      expect(received?.authorization).toBe("Bearer sk-test")
      expect(JSON.parse(received!.body)).toMatchObject({ model: "tiny", stream: true })
    } finally {
      mock.stop(true)
    }
  })

  test("streams Ollama NDJSON responses", async () => {
    const mock = server(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder()
              controller.enqueue(encoder.encode('{"message":{"content":"Hi"},"done":false}\n'))
              controller.enqueue(encoder.encode('{"done":true,"prompt_eval_count":3,"eval_count":1}\n'))
              controller.close()
            },
          }),
        ),
    )
    try {
      const target = OliveProvider.resolveProvider(
        {
          id: "ollama",
          type: "ollama",
          baseURL: `http://127.0.0.1:${mock.port}`,
          models: [{ id: "tiny", context: 1024, maxOutput: 128, tools: true }],
        },
        {},
      )
      const result = await events(target, { model: target.models[0], messages: [message("hi")] })
      expect(result).toEqual([
        { type: "text", text: "Hi" },
        { type: "usage", input: 3, output: 1 },
        { type: "done" },
      ])
    } finally {
      mock.stop(true)
    }
  })
})

describe("olive provider diagnostics", () => {
  const cases = [
    [401, "unauthorized", "rejected the credential"],
    [403, "forbidden", "not allowed"],
    [404, "not-found", "no chat endpoint"],
    [405, "method-not-allowed", "rejected POST"],
    [500, "http-error", "HTTP 500"],
  ] as const

  for (const [status, code, text] of cases) {
    test(`maps HTTP ${status} to ${code}`, async () => {
      let method = ""
      const mock = server((request) => {
        method = request.method
        return new Response(JSON.stringify({ error: { message: "nope" } }), { status })
      })
      try {
        const registry = registryFor(`http://127.0.0.1:${mock.port}/v1`)
        const target = OliveProvider.provider(registry, "local")!
        const failure = events(target, { model: target.models[0], messages: [message("hi")] }).catch(
          (cause: unknown) => cause,
        )
        const error = (await failure) as OliveProvider.ProviderDiagnostic
        expect(error).toBeInstanceOf(OliveProvider.ProviderDiagnostic)
        expect(error.code).toBe(code)
        expect(error.status).toBe(status)
        expect(error.message).toContain(text)
        expect(method).toBe("POST")
      } finally {
        mock.stop(true)
      }
    })
  }

  test("reports context overflow separately from a generic 400", async () => {
    const mock = server(
      () => new Response(JSON.stringify({ error: { message: "context length exceeded: 9000 tokens" } }), { status: 400 }),
    )
    try {
      const target = OliveProvider.provider(registryFor(`http://127.0.0.1:${mock.port}/v1`), "local")!
      const error = (await events(target, { model: target.models[0], messages: [message("hi")] }).catch(
        (cause: unknown) => cause,
      )) as OliveProvider.ProviderDiagnostic
      expect(error.code).toBe("context-overflow")
    } finally {
      mock.stop(true)
    }
  })

  test("reports a malformed stream chunk", async () => {
    const mock = server(() => sse(["data: {not json}\n\n"]))
    try {
      const target = OliveProvider.provider(registryFor(`http://127.0.0.1:${mock.port}/v1`), "local")!
      const error = (await events(target, { model: target.models[0], messages: [message("hi")] }).catch(
        (cause: unknown) => cause,
      )) as OliveProvider.ProviderDiagnostic
      expect(error.code).toBe("invalid-response")
    } finally {
      mock.stop(true)
    }
  })

  test("reports a timeout without leaking the credential", async () => {
    const mock = server(async () => {
      await Bun.sleep(400)
      return sse(["data: [DONE]\n\n"])
    })
    try {
      const target = OliveProvider.resolveProvider(
        {
          id: "slow",
          type: "openai-compatible",
          baseURL: `http://127.0.0.1:${mock.port}/v1`,
          apiKey: "sk-do-not-log",
          timeoutMs: 50,
          models: [{ id: "tiny", context: 1024, maxOutput: 128 }],
        },
        {},
      )
      const error = (await events(target, { model: target.models[0], messages: [message("hi")] }).catch(
        (cause: unknown) => cause,
      )) as OliveProvider.ProviderDiagnostic
      expect(error.code).toBe("timeout")
      expect(error.message).not.toContain("sk-do-not-log")
    } finally {
      mock.stop(true)
    }
  })

  test("refuses tools on a model that does not declare them", async () => {
    const target = OliveProvider.resolveProvider(
      {
        id: "no-tools",
        type: "openai-compatible",
        baseURL: "http://127.0.0.1:1/v1",
        models: [{ id: "tiny", context: 1024, maxOutput: 128 }],
      },
      {},
    )
    const error = (await events(target, {
      model: target.models[0],
      messages: [message("hi")],
      tools: [{ name: "read_file", description: "read", parameters: { type: "object" } }],
    }).catch((cause: unknown) => cause)) as OliveProvider.ProviderDiagnostic
    expect(error.code).toBe("unsupported-tools")
  })
})
