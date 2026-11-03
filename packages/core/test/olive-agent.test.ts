import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OliveAgent } from "../src/olive/agent.js"
import { OliveProvider } from "../src/olive/provider.js"
import { OliveTaskState } from "../src/olive/task-state.js"

const encoder = new TextEncoder()

function stream(chunks: readonly string[]) {
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

function toolCall(name: string, args: Record<string, unknown>) {
  return stream([
    `data: ${JSON.stringify({
      choices: [
        { delta: { tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: JSON.stringify(args) } }] } },
      ],
    })}\n\n`,
    "data: [DONE]\n\n",
  ])
}

function answer(text: string) {
  return stream([`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`, "data: [DONE]\n\n"])
}

function registry(baseURL: string): OliveProvider.Registry {
  const provider = OliveProvider.resolveProvider(
    {
      id: "local",
      type: "openai-compatible",
      baseURL,
      models: [{ id: "olive", context: 4096, maxOutput: 512, tools: true }],
    },
    {},
  )
  return { providers: [provider], default: { provider: "local", model: "olive" }, sources: [] }
}

function mock(responses: readonly (() => Response)[]) {
  const requests: Record<string, unknown>[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push((await request.json()) as Record<string, unknown>)
      return responses[Math.min(requests.length - 1, responses.length - 1)]!()
    },
  })
  return { server, requests, baseURL: `http://127.0.0.1:${server.port}/v1` }
}

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "olive-agent-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe("olive agent", () => {
  test("writes files incrementally and persists the task state after each operation", async () => {
    await withDirectory(async (directory) => {
      const objective = "create hello.txt"
      const fixture = mock([() => toolCall("write_file", { path: "hello.txt", content: "hi" }), () => answer("created hello.txt")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.completed).toBe(true)
        expect(outcome.steps).toBe(2)
        expect(outcome.failures).toEqual([])
        expect(await readFile(path.join(directory, "hello.txt"), "utf8")).toBe("hi")
        expect(outcome.task.files).toContain("hello.txt")
        expect((await OliveTaskState.read(OliveAgent.stateFile(directory)))?.completed).toContain("write initial files")
        const second = fixture.requests[1] as { messages: { content: string }[] }
        expect(second.messages.at(-1)?.content).toContain("hello.txt")
        expect(second.messages.at(-1)?.content).toContain("write_file ok")
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("continues a saved task after a restart", async () => {
    await withDirectory(async (directory) => {
      const objective = "create hello.txt"
      const file = OliveAgent.stateFile(directory)
      const first = mock([() => toolCall("write_file", { path: "hello.txt", content: "hi" }), () => answer("created")])
      try {
        await OliveAgent.run({
          registry: registry(first.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(file, objective),
        })
      } finally {
        first.server.stop(true)
      }
      const second = mock([() => toolCall("edit_file", { path: "hello.txt", old: "hi", new: "bye" }), () => answer("edited")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(second.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(file, objective),
        })
        expect(await readFile(path.join(directory, "hello.txt"), "utf8")).toBe("bye")
        expect(outcome.completed).toBe(true)
        expect(outcome.task.files).toContain("hello.txt")
      } finally {
        second.server.stop(true)
      }
    })
  })

  test("reports a failed tool instead of pretending the operation succeeded", async () => {
    await withDirectory(async (directory) => {
      const objective = "read the missing file"
      const fixture = mock([() => toolCall("read_file", { path: "missing.ts" }), () => answer("everything worked")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.completed).toBe(false)
        expect(outcome.failures).toHaveLength(1)
        expect(outcome.failures[0]?.error.code).toBe("not-found")
        expect(outcome.task.errors.join(" ")).toContain("not-found")
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("refuses to run without a configured provider", async () => {
    await withDirectory(async (directory) => {
      expect(
        OliveAgent.run({
          registry: { providers: [], sources: [] },
          directory,
          objective: "anything",
          state: OliveTaskState.store(OliveAgent.stateFile(directory), "anything"),
        }),
      ).rejects.toThrow("no provider is configured")
    })
  })
})
